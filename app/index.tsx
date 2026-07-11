import {
  AccessibilityInfo,
  Image,
  ImageSourcePropType,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import React, { useEffect, useState } from 'react'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { appStyles } from '@/constants/app-styles'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import Clipboard from '@react-native-clipboard/clipboard'
import { Ionicons } from '@expo/vector-icons'
import { getSolscanAccountUrl, getWalletAddress, isWalletConnected, shortenAddress } from '@/utils/wallet'
import { address as solanaAddress, type Instruction } from '@solana/kit'
import {
  getInitializePoolInstruction,
  getOpenRoundInstruction,
  getPlacePredictionInstruction,
  getTickPredictionAddresses,
  TICK_PREDICTION_PROGRAM_ID,
  type PredictionDirection,
} from '@/features/tick-prediction/tick-prediction-client'
import {
  appendPricePoint,
  fetchBinancePriceHistories,
  subscribeToBinanceTrades,
  type BinanceChartPoint,
  type BinancePoolId,
} from '@/features/prices/binance-prices'

type Pool = {
  accent: string
  chartPoints: number[]
  currentPrice: number
  id: BinancePoolId
  logo: ImageSourcePropType
  name: string
  price: string
  symbol: string
}

const POOLS: Pool[] = [
  {
    accent: '#ff9d17',
    chartPoints: [64258, 64256, 64255, 64254, 64252, 64253, 64251, 64250, 64249, 64248, 64247, 64196, 64186, 64188],
    currentPrice: 64174.06,
    id: 'btc',
    logo: require('../assets/images/btc.webp'),
    name: 'btc daily dash',
    price: '$64,174.06',
    symbol: 'BTC',
  },
  {
    accent: '#8d6bff',
    chartPoints: [142.18, 142.22, 142.19, 142.27, 142.3, 142.26, 142.34, 142.31, 142.29, 142.36, 142.33, 142.31],
    currentPrice: 142.31,
    id: 'sol',
    logo: require('../assets/images/sol.webp'),
    name: 'sol daily dash',
    price: '$142.31',
    symbol: 'SOL',
  },
  {
    accent: '#79a7ff',
    chartPoints: [3306, 3309, 3311, 3308, 3313, 3316, 3312, 3318, 3315, 3320, 3317, 3312],
    currentPrice: 3312.44,
    id: 'eth',
    logo: require('../assets/images/eth.webp'),
    name: 'eth daily dash',
    price: '$3,312.44',
    symbol: 'ETH',
  },
]

type PoolPrediction = {
  direction: PredictionDirection
  price: number
}

type PoolMarketData = {
  chartPoints: BinanceChartPoint[]
  price: number
  updatedAt: number
}

type ChartPathPoint = {
  x: number
  y: number
}

type ChartSegment = {
  left: number
  top: number
  transform: { rotate: string }[]
  width: number
}

const CHART_HEIGHT = 260
const CHART_PADDING = 22
const CHART_AXIS_WIDTH = 86
const ROUND_DURATION_MS = 60_000
const PREDICTION_WINDOW_MS = 30_000
const FALLBACK_POINT_STEP_MS = 1_000

function formatPoolPrice(value: number) {
  return `$${value.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`
}

function formatAxisPrice(value: number, tickSize: number) {
  const absoluteTick = Math.abs(tickSize)
  const decimals = absoluteTick >= 10 ? 0 : absoluteTick >= 1 ? 1 : 2

  return value.toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  })
}

function formatUtcMinute(ms: number) {
  const date = new Date(ms)
  return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')} UTC`
}

function formatRoundTimer(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function getPredictionPrice(price: number, direction: PredictionDirection) {
  const delta = price * 0.0007
  return direction === 'up' ? price + delta : price - delta
}

function getChartY(value: number, min: number, max: number) {
  const range = Math.max(max - min, 1)
  const usableHeight = CHART_HEIGHT - CHART_PADDING * 2
  return CHART_PADDING + (1 - (value - min) / range) * usableHeight
}

function getChartX(timestamp: number, roundStartMs: number, width: number) {
  const elapsed = Math.max(0, Math.min(timestamp - roundStartMs, ROUND_DURATION_MS))
  return (elapsed / ROUND_DURATION_MS) * width
}

function getFallbackChartPoints(points: number[], roundStartMs: number): BinanceChartPoint[] {
  return points.map((price, index) => ({
    price,
    timestamp: roundStartMs + index * FALLBACK_POINT_STEP_MS,
  }))
}

function getChartPathPoints(
  points: BinanceChartPoint[],
  width: number,
  min: number,
  max: number,
  roundStartMs: number,
) {
  return points
    .map((point) => ({
      x: getChartX(point.timestamp, roundStartMs, width),
      y: getChartY(point.price, min, max),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((pointA, pointB) => pointA.x - pointB.x)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function roundPathValue(value: number) {
  return Number(value.toFixed(2))
}

function getCubicPoint(
  start: ChartPathPoint,
  controlOne: ChartPathPoint,
  controlTwo: ChartPathPoint,
  end: ChartPathPoint,
  t: number,
) {
  const inverseT = 1 - t

  return {
    x:
      inverseT ** 3 * start.x +
      3 * inverseT ** 2 * t * controlOne.x +
      3 * inverseT * t ** 2 * controlTwo.x +
      t ** 3 * end.x,
    y:
      inverseT ** 3 * start.y +
      3 * inverseT ** 2 * t * controlOne.y +
      3 * inverseT * t ** 2 * controlTwo.y +
      t ** 3 * end.y,
  }
}

function getLineSegment(start: ChartPathPoint, end: ChartPathPoint): ChartSegment | null {
  const length = Math.hypot(end.x - start.x, end.y - start.y)

  if (length < 0.5) {
    return null
  }

  return {
    left: start.x + (end.x - start.x - length) / 2,
    top: start.y + (end.y - start.y) / 2,
    transform: [{ rotate: `${Math.atan2(end.y - start.y, end.x - start.x)}rad` }],
    width: roundPathValue(length + 1.5),
  }
}

function getSmoothChartSegments(points: ChartPathPoint[]) {
  const segments: ChartSegment[] = []

  if (points.length < 2) {
    return segments
  }

  const smoothing = 0.72

  for (let index = 0; index < points.length - 1; index += 1) {
    const previousPoint = points[index - 1] ?? points[index]
    const currentPoint = points[index]
    const nextPoint = points[index + 1]
    const followingPoint = points[index + 2] ?? nextPoint
    const controlOne = {
      x: clamp(currentPoint.x + ((nextPoint.x - previousPoint.x) / 6) * smoothing, currentPoint.x, nextPoint.x),
      y: clamp(currentPoint.y + ((nextPoint.y - previousPoint.y) / 6) * smoothing, 0, CHART_HEIGHT),
    }
    const controlTwo = {
      x: clamp(nextPoint.x - ((followingPoint.x - currentPoint.x) / 6) * smoothing, currentPoint.x, nextPoint.x),
      y: clamp(nextPoint.y - ((followingPoint.y - currentPoint.y) / 6) * smoothing, 0, CHART_HEIGHT),
    }
    const sampleCount = Math.max(4, Math.ceil((nextPoint.x - currentPoint.x) / 6))
    let previousSample = currentPoint

    for (let sample = 1; sample <= sampleCount; sample += 1) {
      const nextSample = getCubicPoint(currentPoint, controlOne, controlTwo, nextPoint, sample / sampleCount)
      const segment = getLineSegment(previousSample, nextSample)

      if (segment) {
        segments.push(segment)
      }

      previousSample = nextSample
    }
  }

  return segments
}

function getChartPriceRange(values: BinanceChartPoint[], currentPrice: number) {
  const prices = values.map((point) => point.price)
  const minPrice = prices.length ? Math.min(...prices, currentPrice) : currentPrice
  const maxPrice = prices.length ? Math.max(...prices, currentPrice) : currentPrice
  const minRange = Math.max(currentPrice * 0.003, 0.05)
  const visibleRange = Math.max(maxPrice - minPrice, minRange)
  const centerPrice = (minPrice + maxPrice) / 2
  const padding = visibleRange * 0.12

  return {
    max: centerPrice + visibleRange / 2 + padding,
    min: centerPrice - visibleRange / 2 - padding,
  }
}

function getChartRangeValues(points: BinanceChartPoint[], prediction?: PoolPrediction, roundEndMs?: number) {
  if (prediction && roundEndMs) {
    return [...points, { price: prediction.price, timestamp: roundEndMs }]
  }

  return points
}

function getLiveChartSegments(
  points: BinanceChartPoint[],
  width: number,
  min: number,
  max: number,
  roundStartMs: number,
) {
  const pathPoints = getChartPathPoints(points, width, min, max, roundStartMs)
  return getSmoothChartSegments(pathPoints)
}

function getAxisPrices(min: number, max: number) {
  return [0, 1, 2, 3, 4, 5, 6].map((index) => max - ((max - min) * index) / 6)
}

export default function HomeScreen() {
  const { account, client, connect, disconnect, sendTransactions } = useMobileWallet()
  const { width: screenWidth } = useWindowDimensions()
  const [showApp, setShowApp] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [isWalletSheetOpen, setWalletSheetOpen] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Copy Address')
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null)
  const [poolMarketData, setPoolMarketData] = useState<Partial<Record<Pool['id'], PoolMarketData>>>({})
  const [poolPredictions, setPoolPredictions] = useState<Partial<Record<Pool['id'], PoolPrediction>>>({})
  const [predictionStatus, setPredictionStatus] = useState('')
  const [pendingDirection, setPendingDirection] = useState<PredictionDirection | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const tOpacity = useSharedValue(0)
  const tScale = useSharedValue(0.72)
  const tTranslateY = useSharedValue(12)
  const ickOpacity = useSharedValue(0)
  const ickRevealWidth = useSharedValue(0)
  const contentOpacity = useSharedValue(0)

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
  }, [])

  useEffect(() => {
    if (reduceMotion) {
      tOpacity.value = 1
      tScale.value = 1
      tTranslateY.value = 0
      ickOpacity.value = 1
      ickRevealWidth.value = 112
      setShowApp(true)
      contentOpacity.value = 1
      return
    }

    tOpacity.value = withTiming(1, { duration: 120, easing: Easing.out(Easing.cubic) })
    tTranslateY.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) })
    tScale.value = withSequence(
      withSpring(1.08, { damping: 9, stiffness: 170 }),
      withSpring(1, { damping: 13, stiffness: 190 }),
    )
    ickOpacity.value = withDelay(260, withTiming(1, { duration: 80, easing: Easing.out(Easing.cubic) }))
    ickRevealWidth.value = withDelay(260, withTiming(112, { duration: 420, easing: Easing.out(Easing.cubic) }))
    const showAppTimer = setTimeout(() => setShowApp(true), 1250)

    return () => clearTimeout(showAppTimer)
  }, [contentOpacity, ickOpacity, ickRevealWidth, reduceMotion, tOpacity, tScale, tTranslateY])

  useEffect(() => {
    if (!showApp || reduceMotion) {
      return
    }

    contentOpacity.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.cubic) })
  }, [contentOpacity, reduceMotion, showApp])

  useEffect(() => {
    setPredictionStatus('')
    setPendingDirection(null)
  }, [selectedPool])

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const roundStartMs = Math.floor(nowMs / ROUND_DURATION_MS) * ROUND_DURATION_MS
  const roundEndMs = roundStartMs + ROUND_DURATION_MS
  const roundRemainingMs = roundEndMs - nowMs
  const roundElapsedMs = nowMs - roundStartMs
  const predictionOpen = roundElapsedMs < PREDICTION_WINDOW_MS

  useEffect(() => {
    let mounted = true

    setPoolPredictions({})
    setPoolMarketData((currentMarketData) => {
      const nextMarketData = { ...currentMarketData }

      for (const pool of POOLS) {
        const currentPrice = currentMarketData[pool.id]?.price ?? pool.currentPrice
        nextMarketData[pool.id] = {
          chartPoints: [],
          price: currentPrice,
          updatedAt: Date.now(),
        }
      }

      return nextMarketData
    })

    fetchBinancePriceHistories(
      POOLS.map((pool) => pool.id),
      roundStartMs,
    ).then((histories) => {
      if (!mounted) {
        return
      }

      setPoolMarketData((currentMarketData) => {
        const nextMarketData = { ...currentMarketData }

        for (const [poolId, history] of Object.entries(histories) as [
          Pool['id'],
          NonNullable<(typeof histories)[Pool['id']]>,
        ][]) {
          nextMarketData[poolId] = {
            chartPoints: history.chartPoints,
            price: history.price,
            updatedAt: Date.now(),
          }
        }

        return nextMarketData
      })
    })

    const unsubscribe = subscribeToBinanceTrades({
      onPrice: ({ id, price, timestamp }) => {
        if (!mounted) {
          return
        }

        setPoolMarketData((currentMarketData) => {
          const fallbackPool = POOLS.find((pool) => pool.id === id)
          const previousPoints =
            currentMarketData[id]?.chartPoints ??
            (fallbackPool ? getFallbackChartPoints([fallbackPool.currentPrice], roundStartMs) : [])

          return {
            ...currentMarketData,
            [id]: {
              chartPoints:
                timestamp >= roundStartMs ? appendPricePoint(previousPoints, { price, timestamp }) : previousPoints,
              price,
              updatedAt: Date.now(),
            },
          }
        })
      },
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [roundStartMs])

  const tStyle = useAnimatedStyle(() => ({
    opacity: tOpacity.value,
    transform: [{ translateY: tTranslateY.value }, { scale: tScale.value }],
  }))

  const ickRevealStyle = useAnimatedStyle(() => ({
    opacity: ickOpacity.value,
    width: ickRevealWidth.value,
  }))

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }))

  const address = getWalletAddress(account)
  const connected = isWalletConnected(account)
  const chartWidth = Math.max(300, Math.min(screenWidth - 20, 430))
  const chartPlotWidth = Math.max(224, chartWidth - CHART_AXIS_WIDTH)
  const selectedPoolMarketData = selectedPool ? poolMarketData[selectedPool.id] : undefined
  const selectedPoolPrice = selectedPool ? (selectedPoolMarketData?.price ?? selectedPool.currentPrice) : 0
  const selectedPoolChartPoints = selectedPool
    ? selectedPoolMarketData?.chartPoints.length
      ? selectedPoolMarketData.chartPoints
      : getFallbackChartPoints([selectedPool.currentPrice], roundStartMs)
    : []
  const activePrediction = selectedPool ? poolPredictions[selectedPool.id] : undefined
  const chartRangeValues = getChartRangeValues(selectedPoolChartPoints, activePrediction, roundEndMs)
  const { max: chartMax, min: chartMin } = getChartPriceRange(chartRangeValues, selectedPoolPrice)
  const currentLineY = selectedPool ? getChartY(selectedPoolPrice, chartMin, chartMax) : 0
  const predictionLineY = activePrediction ? getChartY(activePrediction.price, chartMin, chartMax) : currentLineY
  const chartSegments = getLiveChartSegments(selectedPoolChartPoints, chartPlotWidth, chartMin, chartMax, roundStartMs)
  const latestChartPoint = selectedPoolChartPoints[selectedPoolChartPoints.length - 1]
  const latestChartX = latestChartPoint ? getChartX(latestChartPoint.timestamp, roundStartMs, chartPlotWidth) : 0
  const latestChartY = latestChartPoint ? getChartY(latestChartPoint.price, chartMin, chartMax) : currentLineY
  const axisPrices = getAxisPrices(chartMin, chartMax)
  const axisTickSize = axisPrices.length > 1 ? Math.abs(axisPrices[0] - axisPrices[1]) : 0
  const phaseBoundaryX = chartPlotWidth / 2

  function openWalletAction() {
    setWalletSheetOpen(true)
  }

  function connectWallet() {
    setWalletSheetOpen(false)
    connect()
  }

  function copyAddress() {
    Clipboard.setString(address)
    setCopyLabel('Copied')
    setTimeout(() => setCopyLabel('Copy Address'), 1400)
  }

  function openSolscan() {
    Linking.openURL(getSolscanAccountUrl(address))
  }

  function disconnectWallet() {
    setWalletSheetOpen(false)
    disconnect()
  }

  function getPoolStartPrice(pool: Pool, price = poolMarketData[pool.id]?.price ?? pool.currentPrice) {
    return BigInt(Math.max(1, Math.round(price * 100)))
  }

  async function placePrediction(direction: PredictionDirection) {
    const activePool = selectedPool
    if (!activePool || pendingDirection) {
      return
    }

    if (!predictionOpen) {
      setPredictionStatus('Prediction is closed for this round. Settlement is in progress.')
      return
    }

    setPendingDirection(direction)
    setPredictionStatus('')

    try {
      const activeMarketData = poolMarketData[activePool.id]
      const activePrice = activeMarketData?.price ?? activePool.currentPrice
      const roundStartPrice = activeMarketData?.chartPoints[0]?.price ?? activePrice
      const walletAccount = account ?? (await connect())
      const predictorAddress = getWalletAddress(walletAccount)

      if (!predictorAddress) {
        throw new Error('Wallet connection did not return an address.')
      }

      const programAccount = await client.rpc
        .getAccountInfo(solanaAddress(TICK_PREDICTION_PROGRAM_ID), { encoding: 'base64' })
        .send()

      if (!programAccount.value) {
        throw new Error('Tick is not deployed on the selected network. Switch to devnet after deploying the program.')
      }

      const roundId = BigInt(roundStartMs)
      const startsAt = BigInt(Math.floor(roundStartMs / 1000))
      const endsAt = BigInt(Math.floor(roundEndMs / 1000))
      const addresses = getTickPredictionAddresses(activePool.symbol, predictorAddress, roundId)
      const poolAccount = await client.rpc.getAccountInfo(solanaAddress(addresses.pool), { encoding: 'base64' }).send()
      const roundAccount = await client.rpc
        .getAccountInfo(solanaAddress(addresses.round), { encoding: 'base64' })
        .send()
      const instructions: Instruction[] = []

      if (!poolAccount.value) {
        instructions.push(
          getInitializePoolInstruction({
            authorityAddress: predictorAddress,
            symbol: activePool.symbol,
          }),
        )
      }

      if (!roundAccount.value) {
        instructions.push(
          getOpenRoundInstruction({
            authorityAddress: predictorAddress,
            endsAt,
            roundId,
            startPrice: getPoolStartPrice(activePool, roundStartPrice),
            startsAt,
            symbol: activePool.symbol,
          }),
        )
      }

      instructions.push(
        getPlacePredictionInstruction({
          direction,
          predictorAddress,
          roundId,
          symbol: activePool.symbol,
        }),
      )

      const signature = await sendTransactions(instructions)

      setPoolPredictions((predictions) => ({
        ...predictions,
        [activePool.id]: {
          direction,
          price: getPredictionPrice(activePrice, direction),
        },
      }))
      setPredictionStatus(`${direction.toUpperCase()} prediction sent: ${shortenAddress(signature, 6)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not send prediction.'
      setPredictionStatus(message)
    } finally {
      setPendingDirection(null)
    }
  }

  return (
    <SafeAreaView style={appStyles.screen}>
      {!showApp ? (
        <View style={appStyles.splash}>
          <View style={appStyles.splashWord}>
            <Animated.View style={[appStyles.splashLogoMark, tStyle]}>
              <Text style={appStyles.splashLogoMarkText}>t</Text>
            </Animated.View>
            <Animated.View style={[appStyles.splashIckReveal, ickRevealStyle]}>
              <Text style={appStyles.splashIck}>ick</Text>
            </Animated.View>
          </View>
        </View>
      ) : (
        <Animated.View style={[appStyles.screen, contentStyle]}>
          <View style={appStyles.appShell}>
            <View style={appStyles.topBar}>
              <View style={appStyles.brand}>
                <View style={appStyles.logoMark}>
                  <Text style={appStyles.logoMarkText}>t</Text>
                </View>
                <Text style={appStyles.brandText}>ick</Text>
              </View>

              <Pressable accessibilityRole="button" onPress={openWalletAction} style={appStyles.walletPill}>
                {connected ? (
                  <>
                    <Ionicons color="#ffffff" name="wallet-outline" size={17} />
                    <Text style={appStyles.walletAddress}>{shortenAddress(address)}</Text>
                  </>
                ) : (
                  <>
                    <Ionicons color="#ffffff" name="wallet-outline" size={17} />
                    <Text style={appStyles.walletConnectText}>CONNECT</Text>
                  </>
                )}
              </Pressable>
            </View>

            {selectedPool ? (
              <View style={appStyles.poolDetail}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSelectedPool(null)}
                  style={appStyles.backButton}
                >
                  <Ionicons color="#ffffff" name="chevron-back" size={17} />
                  <Text style={appStyles.backButtonText}>POOLS</Text>
                </Pressable>

                <View style={appStyles.poolHeader}>
                  <View style={appStyles.poolSide}>
                    <Text style={appStyles.poolAsset}>{selectedPool.symbol}</Text>
                    <Text style={[appStyles.poolPrice, { color: selectedPool.accent }]}>
                      {formatPoolPrice(selectedPoolPrice)}
                    </Text>
                  </View>
                  <View style={[appStyles.poolSide, appStyles.poolSideRight]}>
                    <Text style={appStyles.poolPredictLabel}>{predictionOpen ? 'PREDICT' : 'SETTLE'}</Text>
                    <Text style={appStyles.poolTimer}>{formatRoundTimer(roundRemainingMs)}</Text>
                  </View>
                </View>

                <View style={appStyles.priceChartCard}>
                  <View style={appStyles.priceChartTopRow}>
                    <View style={appStyles.priceChartAsset}>
                      <Image source={selectedPool.logo} style={appStyles.priceChartLogo} />
                      <Text style={appStyles.priceChartSymbol}>{selectedPool.symbol}</Text>
                    </View>
                    <Text style={[appStyles.priceChartValue, { color: selectedPool.accent }]}>
                      {formatPoolPrice(selectedPoolPrice)}
                    </Text>
                  </View>
                  <View style={appStyles.priceChartRoundRow}>
                    <Text style={appStyles.priceChartRoundText}>{formatUtcMinute(roundStartMs)}</Text>
                    <Text style={appStyles.priceChartRoundText}>{formatUtcMinute(roundEndMs)}</Text>
                  </View>

                  <View style={[appStyles.priceChart, { height: CHART_HEIGHT, width: chartWidth }]}>
                    {[0, 1, 2, 3, 4].map((line) => (
                      <View
                        key={`grid-${line}`}
                        style={[
                          appStyles.priceChartGridLine,
                          {
                            top: CHART_PADDING + line * ((CHART_HEIGHT - CHART_PADDING * 2) / 4),
                            width: chartPlotWidth,
                          },
                        ]}
                      />
                    ))}
                    <View
                      style={[
                        appStyles.priceChartFutureZone,
                        {
                          left: phaseBoundaryX,
                          width: chartPlotWidth - phaseBoundaryX,
                        },
                      ]}
                    />
                    <View style={[appStyles.priceChartPhaseDivider, { left: phaseBoundaryX }]} />
                    <Text
                      style={[
                        appStyles.priceChartLayerLabel,
                        {
                          left: 12,
                        },
                      ]}
                    >
                      PREDICT
                    </Text>
                    <Text
                      style={[
                        appStyles.priceChartLayerLabel,
                        appStyles.priceChartLayerLabelRight,
                        {
                          left: phaseBoundaryX + 12,
                        },
                      ]}
                    >
                      SETTLE
                    </Text>
                    {chartSegments.map((segment, index) => (
                      <View
                        key={`chart-segment-${index}`}
                        style={[
                          appStyles.priceChartSegmentGlow,
                          {
                            backgroundColor: selectedPool.accent,
                          },
                          segment,
                        ]}
                      />
                    ))}
                    {chartSegments.map((segment, index) => (
                      <View
                        key={`chart-line-${index}`}
                        style={[
                          appStyles.priceChartSegment,
                          {
                            backgroundColor: selectedPool.accent,
                          },
                          segment,
                        ]}
                      />
                    ))}
                    <View style={[appStyles.priceChartGuideLine, { top: currentLineY, width: chartPlotWidth }]} />
                    {activePrediction ? (
                      <View
                        style={[
                          appStyles.priceChartPredictionLine,
                          {
                            top: predictionLineY,
                            width: chartPlotWidth,
                          },
                        ]}
                      />
                    ) : null}
                    <View style={[appStyles.priceChartAxisRail, { left: chartPlotWidth, width: CHART_AXIS_WIDTH }]} />
                    {axisPrices.map((price, index) => (
                      <Text
                        key={`axis-${index}`}
                        style={[
                          appStyles.priceChartAxisLabel,
                          {
                            left: chartPlotWidth + 9,
                            top: getChartY(price, chartMin, chartMax) - 9,
                            width: CHART_AXIS_WIDTH - 12,
                          },
                        ]}
                      >
                        {formatAxisPrice(price, axisTickSize)}
                      </Text>
                    ))}
                    <View
                      style={[
                        appStyles.priceChartCurrentDot,
                        {
                          backgroundColor: selectedPool.accent,
                          borderColor: `${selectedPool.accent}42`,
                          left: latestChartX - 11,
                          top: latestChartY - 11,
                        },
                      ]}
                    />
                    {activePrediction ? (
                      <View
                        style={[
                          appStyles.priceChartPredictionPill,
                          {
                            left: Math.max(12, chartPlotWidth - 152),
                            top: predictionLineY - 19,
                          },
                        ]}
                      >
                        <Text style={appStyles.priceChartPredictionText}>My Prediction</Text>
                      </View>
                    ) : null}
                    <View
                      style={[
                        appStyles.priceChartPriceTag,
                        {
                          backgroundColor: selectedPool.accent,
                          right: CHART_AXIS_WIDTH + 4,
                          top: currentLineY - 17,
                        },
                      ]}
                    >
                      <Text style={appStyles.priceChartPriceTagText}>{formatPoolPrice(selectedPoolPrice)}</Text>
                    </View>
                  </View>

                  <View style={appStyles.predictionActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={Boolean(pendingDirection) || !predictionOpen}
                      onPress={() => placePrediction('up')}
                      style={({ pressed }) => [
                        appStyles.predictionButton,
                        appStyles.predictionButtonUp,
                        pressed && appStyles.poolCardPressed,
                        (pendingDirection || !predictionOpen) && appStyles.predictionButtonDisabled,
                      ]}
                    >
                      <Ionicons color="#000000" name="trending-up" size={20} />
                      <Text style={appStyles.predictionButtonText}>
                        {!predictionOpen ? 'closed' : pendingDirection === 'up' ? 'sending' : 'up'}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={Boolean(pendingDirection) || !predictionOpen}
                      onPress={() => placePrediction('down')}
                      style={({ pressed }) => [
                        appStyles.predictionButton,
                        appStyles.predictionButtonDown,
                        pressed && appStyles.poolCardPressed,
                        (pendingDirection || !predictionOpen) && appStyles.predictionButtonDisabled,
                      ]}
                    >
                      <Ionicons color="#ffffff" name="trending-down" size={20} />
                      <Text style={[appStyles.predictionButtonText, appStyles.predictionButtonTextLight]}>
                        {!predictionOpen ? 'closed' : pendingDirection === 'down' ? 'sending' : 'down'}
                      </Text>
                    </Pressable>
                  </View>
                  {predictionStatus ? <Text style={appStyles.predictionStatus}>{predictionStatus}</Text> : null}
                </View>
              </View>
            ) : (
              <ScrollView contentContainerStyle={appStyles.poolList} showsVerticalScrollIndicator={false}>
                {POOLS.map((pool) => (
                  <Pressable
                    accessibilityRole="button"
                    key={pool.id}
                    onPress={() => setSelectedPool(pool)}
                    style={({ pressed }) => [appStyles.poolCard, pressed && appStyles.poolCardPressed]}
                  >
                    <View style={[appStyles.poolLogo, { borderColor: pool.accent }]}>
                      <Image source={pool.logo} style={appStyles.poolLogoImage} />
                    </View>

                    <View style={appStyles.poolCardContent}>
                      <Text style={appStyles.poolCardTitle}>{pool.name}</Text>
                      <Text style={appStyles.poolCardTime}>1 min</Text>
                    </View>

                    <View style={appStyles.poolCardFooter}>
                      <Text style={appStyles.poolCardPrice}>
                        Current price : {formatPoolPrice(poolMarketData[pool.id]?.price ?? pool.currentPrice)}
                      </Text>
                      <View style={appStyles.tickItButton}>
                        <Text style={appStyles.tickItButtonText}>tick it</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>

          <Modal
            animationType="slide"
            transparent
            visible={isWalletSheetOpen}
            onRequestClose={() => setWalletSheetOpen(false)}
          >
            <Pressable style={appStyles.sheetBackdrop} onPress={() => setWalletSheetOpen(false)}>
              <Pressable style={appStyles.walletSheet}>
                <View style={appStyles.sheetHandle} />
                <Text style={appStyles.sheetTitle}>{connected ? 'Wallet' : 'Connect Wallet'}</Text>
                {connected ? (
                  <>
                    <Text selectable style={appStyles.fullAddress}>
                      {address}
                    </Text>

                    <Pressable accessibilityRole="button" onPress={copyAddress} style={appStyles.sheetAction}>
                      <Text style={appStyles.sheetActionText}>{copyLabel}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="link" onPress={openSolscan} style={appStyles.sheetAction}>
                      <Text style={appStyles.sheetActionText}>View on Solscan</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={disconnectWallet}
                      style={appStyles.sheetActionDanger}
                    >
                      <Text style={appStyles.sheetActionDangerText}>Disconnect Wallet</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={appStyles.sheetBodyText}>Connect a Solana wallet to start predicting.</Text>
                    <Pressable accessibilityRole="button" onPress={connectWallet} style={appStyles.sheetActionPrimary}>
                      <Ionicons color="#000000" name="wallet-outline" size={18} />
                      <Text style={appStyles.sheetActionPrimaryText}>CONNECT WALLET</Text>
                    </Pressable>
                  </>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        </Animated.View>
      )}
    </SafeAreaView>
  )
}
