export type BinancePoolId = 'btc' | 'sol' | 'eth'

export type BinancePricePoint = {
  id: BinancePoolId
  price: number
  timestamp: number
}

export type BinanceChartPoint = {
  price: number
  timestamp: number
}

export type BinancePriceHistory = BinancePricePoint & {
  chartPoints: BinanceChartPoint[]
}

const BINANCE_SYMBOL_BY_POOL: Record<BinancePoolId, string> = {
  btc: 'BTCUSDT',
  eth: 'ETHUSDT',
  sol: 'SOLUSDT',
}

const POOL_BY_BINANCE_SYMBOL = Object.entries(BINANCE_SYMBOL_BY_POOL).reduce<Record<string, BinancePoolId>>(
  (poolBySymbol, [poolId, symbol]) => ({
    ...poolBySymbol,
    [symbol]: poolId as BinancePoolId,
  }),
  {},
)

const BINANCE_REST_ENDPOINT = 'https://api.binance.com'
const BINANCE_WS_ENDPOINT = 'wss://stream.binance.com:9443/stream'
const CHART_POINT_LIMIT = 720
const ONE_SECOND_MS = 1_000

type BinanceKline = [number, string, string, string, string, string, number, string, number, string, string, string]

type BinanceTradeMessage = {
  data?: {
    p?: string
    s?: string
  }
}

function parsePrice(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const price = Number(value)
  return Number.isFinite(price) && price > 0 ? price : null
}

export function appendPricePoint(points: BinanceChartPoint[], point: BinanceChartPoint, limit = CHART_POINT_LIMIT) {
  const secondPoint = {
    ...point,
    timestamp: Math.floor(point.timestamp / ONE_SECOND_MS) * ONE_SECOND_MS,
  }
  const lastPoint = points[points.length - 1]
  const nextPoints =
    lastPoint && lastPoint.timestamp === secondPoint.timestamp
      ? [...points.slice(0, -1), secondPoint]
      : [...points, secondPoint]

  if (nextPoints.length <= limit) {
    return nextPoints
  }

  return [nextPoints[0], ...nextPoints.slice(-(limit - 1))]
}

export async function fetchBinancePriceHistory(
  poolId: BinancePoolId,
  roundStartMs: number,
): Promise<BinancePriceHistory> {
  const symbol = BINANCE_SYMBOL_BY_POOL[poolId]
  const response = await fetch(
    `${BINANCE_REST_ENDPOINT}/api/v3/klines?symbol=${symbol}&interval=1s&startTime=${roundStartMs}&endTime=${roundStartMs + 59999}&limit=${CHART_POINT_LIMIT}`,
  )

  if (!response.ok) {
    throw new Error(`Binance history request failed for ${symbol}.`)
  }

  const klines = (await response.json()) as BinanceKline[]
  const chartPoints = klines
    .map((kline) => ({
      price: Number(kline[4]),
      timestamp: kline[0],
    }))
    .filter((point) => Number.isFinite(point.price) && point.price > 0)

  if (!chartPoints.length) {
    throw new Error(`Binance returned no usable history for ${symbol}.`)
  }

  return {
    chartPoints,
    id: poolId,
    price: chartPoints[chartPoints.length - 1].price,
    timestamp: chartPoints[chartPoints.length - 1].timestamp,
  }
}

export async function fetchBinancePriceHistories(poolIds: BinancePoolId[], roundStartMs: number) {
  const histories = await Promise.allSettled(poolIds.map((poolId) => fetchBinancePriceHistory(poolId, roundStartMs)))

  return histories.reduce<Partial<Record<BinancePoolId, BinancePriceHistory>>>((priceByPool, result) => {
    if (result.status === 'fulfilled') {
      priceByPool[result.value.id] = result.value
    }

    return priceByPool
  }, {})
}

export function subscribeToBinanceTrades({
  onError,
  onPrice,
}: {
  onError?: (error: Event) => void
  onPrice: (pricePoint: BinancePricePoint) => void
}) {
  const streams = Object.values(BINANCE_SYMBOL_BY_POOL)
    .map((symbol) => `${symbol.toLowerCase()}@trade`)
    .join('/')
  const socket = new WebSocket(`${BINANCE_WS_ENDPOINT}?streams=${streams}`)

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as BinanceTradeMessage
      const symbol = message.data?.s
      const poolId = symbol ? POOL_BY_BINANCE_SYMBOL[symbol] : undefined
      const price = parsePrice(message.data?.p)

      if (!poolId || !price) {
        return
      }

      onPrice({ id: poolId, price, timestamp: Date.now() })
    } catch {
      // Ignore malformed stream payloads and wait for the next trade tick.
    }
  }

  socket.onerror = (event) => {
    onError?.(event)
  }

  return () => {
    socket.close()
  }
}
