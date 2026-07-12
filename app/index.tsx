import {
  AccessibilityInfo,
  Image,
  ImageSourcePropType,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import React, { useCallback, useEffect, useState } from 'react'
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
import { getWalletAddress, getWalletAvatar, isWalletConnected, shortenAddress } from '@/utils/wallet'
import { address as solanaAddress, type Instruction } from '@solana/kit'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import {
  getClaimPayoutInstruction,
  getCreateUserUsdcAccountInstruction,
  getAuthorizePoolSessionInstruction,
  getDelegatePredictionInstruction,
  getDelegateRoundInstruction,
  getFundPredictionInstruction,
  getInitializePoolInstruction,
  getOpenRoundInstruction,
  getOpenRoundWithSessionInstruction,
  getPlaceTilePredictionInstruction,
  getSelectTileOnErInstruction,
  getSettleRoundInstruction,
  getTickPredictionAddresses,
  getTransferUsdcInstruction,
  getUndelegatePredictionInstruction,
  getUndelegateRoundInstruction,
  getUserTokenAccountAddress,
  kitInstructionToWeb3Instruction,
  TILE_MULTIPLIERS_BPS,
  TILE_STAKE_BASE_UNITS,
  TILE_STAKE_USDC,
  TICK_PREDICTION_PROGRAM_ID,
} from '@/features/tick-prediction/tick-prediction-client'
import {
  appendPricePoint,
  fetchBinancePriceHistories,
  subscribeToBinanceTrades,
  type BinanceChartPoint,
  type BinancePoolId,
} from '@/features/prices/binance-prices'
import { AppConfig } from '@/constants/app-config'
import { Buffer } from 'buffer'
import * as Haptics from 'expo-haptics'
import { lamportsToSol } from '@/utils/lamports-to-sol'

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
  autoClaimStarted?: boolean
  claimed?: boolean
  feedbackShown?: boolean
  multiplierBps: number
  roundId: bigint
  roundStartPrice: number
  settledFinalPrice?: number
  tileIndex: number
  winningTileIndex?: number
}

type PreparedPrediction = {
  authorityAddress: string
  expiresAtMs: number
  sessionKeypair: Keypair
}

type ResultFeedback = {
  message: string
  settledAtMs: number
  title: string
  type: 'win' | 'lose'
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

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const CHART_HEIGHT = 260
const CHART_PADDING = 22
const CHART_AXIS_WIDTH = 70
const ROUND_DURATION_MS = 60_000
const PREDICTION_WINDOW_MS = 30_000
const PREDICTION_WALLET_CONFIRM_BUFFER_MS = 8_000
const FALLBACK_POINT_STEP_MS = 1_000
const TILE_SIZE = 24
const TILE_BUTTON_GAP = 2
const RESULT_FEEDBACK_MS = 2000
const RESULT_SHEET_FEEDBACK_MS = 4200
const MAGICBLOCK_SESSION_SPONSOR_LAMPORTS = 100_000_000
const MAGICBLOCK_MIN_SESSION_LAMPORTS = 20_000_000
const MAGICBLOCK_SESSION_PREDICTION_CREDITS = 5n
const CHART_SMOOTHING_STEPS = 6
const WIN_VIBRATION_PATTERN = [0, 420, 220, 420, 220, 420, 300]
const LOSE_VIBRATION_PATTERN = [0, 180, 120, 180, 120, 180, 1220]
const PRICE_AXIS_RANGE_BY_POOL: Record<Pool['id'], number> = {
  btc: 10,
  eth: 2,
  sol: 0.2,
}
const CHART_RANGE_PADDING_RATIO = 0.08

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

function formatResultDate(ms: number) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZoneName: 'short',
    year: 'numeric',
  }).format(new Date(ms))
}

function formatRoundTimer(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatWalletTokenBalance(balance: number | null) {
  if (balance === null) {
    return '...'
  }

  return balance.toLocaleString('en-US', {
    maximumFractionDigits: 3,
    minimumFractionDigits: 3,
  })
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

function playWebResultMusic(type: ResultFeedback['type']) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return
  }

  const AudioContextConstructor =
    window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextConstructor) {
    return
  }

  const context = new AudioContextConstructor()
  const gain = context.createGain()
  const now = context.currentTime
  const notes =
    type === 'win'
      ? [
          { frequency: 523.25, start: 0, duration: 0.16 },
          { frequency: 659.25, start: 0.16, duration: 0.16 },
          { frequency: 783.99, start: 0.32, duration: 0.28 },
        ]
      : [
          { frequency: 392, start: 0, duration: 0.18 },
          { frequency: 329.63, start: 0.18, duration: 0.18 },
          { frequency: 261.63, start: 0.36, duration: 0.32 },
        ]

  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(type === 'win' ? 0.12 : 0.08, now + 0.03)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.86)
  gain.connect(context.destination)

  notes.forEach(({ duration, frequency, start }) => {
    const oscillator = context.createOscillator()
    oscillator.frequency.setValueAtTime(frequency, now + start)
    oscillator.type = type === 'win' ? 'triangle' : 'sine'
    oscillator.connect(gain)
    oscillator.start(now + start)
    oscillator.stop(now + start + duration)
  })

  window.setTimeout(() => {
    context.close().catch(() => undefined)
  }, RESULT_FEEDBACK_MS)
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

function getChartDisplayPoints(points: BinanceChartPoint[], currentPrice: number, timestamp: number) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return points
  }

  return appendPricePoint(points, { price: currentPrice, timestamp })
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function roundPathValue(value: number) {
  return Number(value.toFixed(2))
}

function getCatmullRomPoint(
  pointA: ChartPathPoint,
  pointB: ChartPathPoint,
  pointC: ChartPathPoint,
  pointD: ChartPathPoint,
  progress: number,
) {
  const progressSquared = progress * progress
  const progressCubed = progressSquared * progress

  return {
    x:
      0.5 *
      (2 * pointB.x +
        (-pointA.x + pointC.x) * progress +
        (2 * pointA.x - 5 * pointB.x + 4 * pointC.x - pointD.x) * progressSquared +
        (-pointA.x + 3 * pointB.x - 3 * pointC.x + pointD.x) * progressCubed),
    y:
      0.5 *
      (2 * pointB.y +
        (-pointA.y + pointC.y) * progress +
        (2 * pointA.y - 5 * pointB.y + 4 * pointC.y - pointD.y) * progressSquared +
        (-pointA.y + 3 * pointB.y - 3 * pointC.y + pointD.y) * progressCubed),
  }
}

function getSmoothedChartPathPoints(points: ChartPathPoint[]) {
  if (points.length < 3) {
    return points
  }

  const smoothedPoints: ChartPathPoint[] = []

  for (let index = 0; index < points.length - 1; index += 1) {
    const pointA = points[Math.max(0, index - 1)]
    const pointB = points[index]
    const pointC = points[index + 1]
    const pointD = points[Math.min(points.length - 1, index + 2)]

    smoothedPoints.push(pointB)

    for (let step = 1; step < CHART_SMOOTHING_STEPS; step += 1) {
      const progress = step / CHART_SMOOTHING_STEPS
      const point = getCatmullRomPoint(pointA, pointB, pointC, pointD, progress)

      if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
        smoothedPoints.push(point)
      }
    }
  }

  smoothedPoints.push(points[points.length - 1])

  return smoothedPoints
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

function getPoolPriceAxisRange(poolId: Pool['id']) {
  return PRICE_AXIS_RANGE_BY_POOL[poolId]
}

function getChartPriceRange(
  values: BinanceChartPoint[],
  currentPrice: number,
  poolId?: Pool['id'],
  centerPrice?: number,
) {
  const prices = values.map((point) => point.price).filter((price) => Number.isFinite(price) && price > 0)
  const anchorPrice = centerPrice ?? currentPrice

  if (poolId) {
    const minimumRange = getPoolPriceAxisRange(poolId)
    const priceFloor = Math.min(...prices, currentPrice, anchorPrice)
    const priceCeiling = Math.max(...prices, currentPrice, anchorPrice)
    const padding = minimumRange * CHART_RANGE_PADDING_RATIO
    const paddedMin = priceFloor - padding
    const paddedMax = priceCeiling + padding
    const visibleRange = Math.max(minimumRange, paddedMax - paddedMin)
    const center = (paddedMin + paddedMax) / 2

    return {
      max: center + visibleRange / 2,
      min: center - visibleRange / 2,
    }
  }

  const minPrice = prices.length ? Math.min(...prices, currentPrice) : currentPrice
  const maxPrice = prices.length ? Math.max(...prices, currentPrice) : currentPrice
  const minRange = getPoolPriceAxisRange('btc')
  const visibleRange = Math.max(maxPrice - minPrice, minRange)
  const fallbackCenterPrice = (minPrice + maxPrice) / 2
  const padding = visibleRange * CHART_RANGE_PADDING_RATIO

  return {
    max: fallbackCenterPrice + visibleRange / 2 + padding,
    min: fallbackCenterPrice - visibleRange / 2 - padding,
  }
}

function getChartRangeValues(points: BinanceChartPoint[]) {
  return points
}

function getLiveChartSegments(
  points: BinanceChartPoint[],
  width: number,
  min: number,
  max: number,
  roundStartMs: number,
) {
  const pathPoints = getSmoothedChartPathPoints(getChartPathPoints(points, width, min, max, roundStartMs))
  const segments: ChartSegment[] = []

  for (let index = 0; index < pathPoints.length - 1; index += 1) {
    const segment = getLineSegment(pathPoints[index], pathPoints[index + 1])

    if (segment) {
      segments.push(segment)
    }
  }

  return segments
}

function getAxisPrices(min: number, max: number) {
  return [0, 1, 2, 3, 4, 5, 6].map((index) => max - ((max - min) * index) / 6)
}

function formatMultiplier(multiplierBps: number) {
  return `${(multiplierBps / 10_000).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: multiplierBps % 10_000 === 0 ? 0 : 1,
  })}x`
}

function formatUsdcAmount(amount: number) {
  return `$${amount.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}`
}

function formatUsdcBaseUnits(amount: bigint) {
  return formatUsdcAmount(Number(amount) / 1_000_000)
}

function getPayoutAmount(multiplierBps: number) {
  return TILE_STAKE_USDC + TILE_STAKE_USDC * (multiplierBps / 10_000)
}

function getPayoutBaseUnits(multiplierBps: number) {
  return TILE_STAKE_BASE_UNITS + (TILE_STAKE_BASE_UNITS * BigInt(multiplierBps)) / 10_000n
}

function getTileIndexFromPrice(startPrice: number, finalPrice: number, poolId: Pool['id']) {
  const axisRange = getPoolPriceAxisRange(poolId)
  const minPrice = startPrice - axisRange / 2
  const rawTileIndex = Math.floor(((finalPrice - minPrice) * TILE_MULTIPLIERS_BPS.length) / axisRange)

  return Math.max(0, Math.min(TILE_MULTIPLIERS_BPS.length - 1, rawTileIndex))
}

function getTilePriceRange(startPrice: number, tileIndex: number, poolId: Pool['id']) {
  const axisRange = getPoolPriceAxisRange(poolId)
  const minPrice = startPrice - axisRange / 2
  const lower = minPrice + (axisRange * tileIndex) / TILE_MULTIPLIERS_BPS.length
  const upper = minPrice + (axisRange * (tileIndex + 1)) / TILE_MULTIPLIERS_BPS.length

  return {
    lower,
    upper,
  }
}

function getTileAxisPrice(startPrice: number, tileIndex: number, poolId: Pool['id']) {
  const range = getTilePriceRange(startPrice, tileIndex, poolId)

  if (typeof range.lower === 'number' && typeof range.upper === 'number') {
    return (range.lower + range.upper) / 2
  }

  if (typeof range.lower === 'number') {
    return range.lower
  }

  if (typeof range.upper === 'number') {
    return range.upper
  }

  return startPrice
}

function getPredictionEndsAtMs(prediction?: PoolPrediction) {
  return prediction ? Number(prediction.roundId) + ROUND_DURATION_MS : null
}

function getTileLayouts(
  chartPlotWidth: number,
  chartMin: number,
  chartMax: number,
  roundStartPrice: number,
  poolId: Pool['id'],
) {
  const tileWidth = TILE_SIZE
  const minTop = 6
  const maxTop = CHART_HEIGHT - TILE_SIZE - 6
  const orderedLayouts = TILE_MULTIPLIERS_BPS.map((_, tileIndex) => ({
    tileIndex,
    top: clamp(
      getChartY(getTileAxisPrice(roundStartPrice, tileIndex, poolId), chartMin, chartMax) - TILE_SIZE / 2,
      minTop,
      maxTop,
    ),
  })).sort((layoutA, layoutB) => layoutA.top - layoutB.top)

  for (let index = 1; index < orderedLayouts.length; index += 1) {
    orderedLayouts[index].top = Math.max(
      orderedLayouts[index].top,
      orderedLayouts[index - 1].top + TILE_SIZE + TILE_BUTTON_GAP,
    )
  }

  const overflow = orderedLayouts[orderedLayouts.length - 1].top - maxTop

  if (overflow > 0) {
    for (const layout of orderedLayouts) {
      layout.top -= overflow
    }

    orderedLayouts[0].top = Math.max(orderedLayouts[0].top, minTop)

    for (let index = 1; index < orderedLayouts.length; index += 1) {
      orderedLayouts[index].top = Math.max(
        orderedLayouts[index].top,
        orderedLayouts[index - 1].top + TILE_SIZE + TILE_BUTTON_GAP,
      )
    }
  }

  return orderedLayouts.reduce<Record<number, { height: number; left: number; top: number; width: number }>>(
    (layoutsByTile, layout) => ({
      ...layoutsByTile,
      [layout.tileIndex]: {
        height: TILE_SIZE,
        left: chartPlotWidth - TILE_SIZE - 10,
        top: layout.top,
        width: tileWidth,
      },
    }),
    {},
  )
}

function clearPoolPrediction(
  setPoolPredictions: React.Dispatch<React.SetStateAction<Partial<Record<Pool['id'], PoolPrediction>>>>,
  poolId: Pool['id'],
  roundId: bigint,
) {
  setPoolPredictions((predictions) => {
    if (predictions[poolId]?.roundId !== roundId) {
      return predictions
    }

    return {
      ...predictions,
      [poolId]: undefined,
    }
  })
}

function getPredictionRouteLabel() {
  return AppConfig.magicBlock.enabled ? 'MagicBlock ER' : 'Devnet wallet tx'
}

function isUserCancelledError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /cancel|reject|declin|user.*denied|authorization.*failed/i.test(message)
}

function getPoolStartPrice(price: number) {
  return BigInt(Math.max(1, Math.round(price * 100)))
}

function getConfiguredUsdcMint() {
  if (!AppConfig.devnetUsdcMint) {
    throw new Error('Set EXPO_PUBLIC_DEVNET_USDC_MINT to your devnet USDC mint before placing $1 tile predictions.')
  }

  return AppConfig.devnetUsdcMint
}

function getBase64AccountData(accountInfo: unknown) {
  if (!accountInfo || typeof accountInfo !== 'object' || !('data' in accountInfo)) {
    return ''
  }

  const { data } = accountInfo as { data?: unknown }

  if (Array.isArray(data) && typeof data[0] === 'string') {
    return data[0]
  }

  return typeof data === 'string' ? data : ''
}

function getSplTokenAccountAmount(accountInfo: unknown) {
  const encodedData = getBase64AccountData(accountInfo)

  if (!encodedData) {
    return 0n
  }

  const accountData = Buffer.from(encodedData, 'base64')

  if (accountData.length < 72) {
    return 0n
  }

  return accountData.readBigUInt64LE(64)
}

function getSplMintDecimals(accountInfo: unknown) {
  const encodedData = getBase64AccountData(accountInfo)

  if (!encodedData) {
    return null
  }

  const mintData = Buffer.from(encodedData, 'base64')

  if (mintData.length < 45) {
    return null
  }

  return mintData[44]
}

function decodeBase58(value: string) {
  const bytes = [0]

  for (const character of value) {
    const alphabetIndex = BASE58_ALPHABET.indexOf(character)

    if (alphabetIndex === -1) {
      throw new Error('Invalid base58 character.')
    }

    let carry = alphabetIndex

    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58
      bytes[index] = carry & 0xff
      carry >>= 8
    }

    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  for (const character of value) {
    if (character !== '1') {
      break
    }

    bytes.push(0)
  }

  return Uint8Array.from(bytes.reverse())
}

function keypairFromHouseWalletSecretBytes(secretBytes: Uint8Array) {
  if (secretBytes.length === 64) {
    return Keypair.fromSecretKey(secretBytes)
  }

  if (secretBytes.length === 32) {
    return Keypair.fromSeed(secretBytes)
  }

  throw new Error('House wallet private key must decode to 64 bytes, or 32 bytes for a seed.')
}

function getDevnetHouseWalletKeypair() {
  const secretKey = AppConfig.magicBlock.sessionSponsorSecretKey.trim().replace(/^['"]|['"]$/g, '')

  if (!secretKey) {
    return null
  }

  try {
    if (secretKey.startsWith('[')) {
      return keypairFromHouseWalletSecretBytes(Uint8Array.from(JSON.parse(secretKey) as number[]))
    }

    const base64SecretKey = Uint8Array.from(Buffer.from(secretKey, 'base64'))

    if (base64SecretKey.length === 64 || base64SecretKey.length === 32) {
      return keypairFromHouseWalletSecretBytes(base64SecretKey)
    }

    return keypairFromHouseWalletSecretBytes(decodeBase58(secretKey))
  } catch (error) {
    throw new Error(
      `EXPO_PUBLIC_DEVNET_HOUSE_WALLET_SECRET_KEY is invalid. Use a Solana JSON keypair array, base64 secret key, or base58 private key. ${
        error instanceof Error ? error.message : ''
      }`.trim(),
    )
  }
}

export default function HomeScreen() {
  const { account, client, connect, disconnect, sendTransactions } = useMobileWallet()
  const { width: screenWidth } = useWindowDimensions()
  const [showApp, setShowApp] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [isWalletSheetOpen, setWalletSheetOpen] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Copy Address')
  const [walletSolBalance, setWalletSolBalance] = useState<number | null>(null)
  const [walletUsdcBalance, setWalletUsdcBalance] = useState<number | null>(null)
  const [walletBalanceLoading, setWalletBalanceLoading] = useState(false)
  const [walletBalanceError, setWalletBalanceError] = useState('')
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null)
  const [poolMarketData, setPoolMarketData] = useState<Partial<Record<Pool['id'], PoolMarketData>>>({})
  const [poolPredictions, setPoolPredictions] = useState<Partial<Record<Pool['id'], PoolPrediction>>>({})
  const [preparedPredictions, setPreparedPredictions] = useState<Partial<Record<Pool['id'], PreparedPrediction>>>({})
  const [predictionStatus, setPredictionStatus] = useState('')
  const [pendingTileIndex, setPendingTileIndex] = useState<number | null>(null)
  const [preparePendingPoolId, setPreparePendingPoolId] = useState<Pool['id'] | null>(null)
  const [claimPendingRoundId, setClaimPendingRoundId] = useState<bigint | null>(null)
  const [resultFeedback, setResultFeedback] = useState<ResultFeedback | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const tOpacity = useSharedValue(0)
  const tScale = useSharedValue(0.72)
  const tTranslateY = useSharedValue(12)
  const ickOpacity = useSharedValue(0)
  const ickRevealWidth = useSharedValue(0)
  const contentOpacity = useSharedValue(0)
  const chartLiveX = useSharedValue(0)
  const chartLiveY = useSharedValue(0)
  const chartPulse = useSharedValue(1)
  const resultSheetOpacity = useSharedValue(0)
  const resultSheetTranslateY = useSharedValue(36)

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
    setPendingTileIndex(null)
    setPreparePendingPoolId(null)
  }, [selectedPool])

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!resultFeedback) {
      return
    }

    if (reduceMotion) {
      resultSheetOpacity.value = 1
      resultSheetTranslateY.value = 0
    } else {
      resultSheetOpacity.value = 0
      resultSheetTranslateY.value = 36
      resultSheetOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) })
      resultSheetTranslateY.value = withSpring(0, { damping: 18, stiffness: 190 })
    }

    const feedbackTimer = setTimeout(() => {
      setResultFeedback(null)
      Vibration.cancel()
      resultSheetOpacity.value = 0
      resultSheetTranslateY.value = 36
    }, RESULT_SHEET_FEEDBACK_MS)

    return () => {
      clearTimeout(feedbackTimer)
      Vibration.cancel()
    }
  }, [reduceMotion, resultFeedback, resultSheetOpacity, resultSheetTranslateY])

  const roundStartMs = Math.floor(nowMs / ROUND_DURATION_MS) * ROUND_DURATION_MS
  const roundEndMs = roundStartMs + ROUND_DURATION_MS
  const roundRemainingMs = roundEndMs - nowMs
  const roundElapsedMs = nowMs - roundStartMs
  const predictionOpen = roundElapsedMs < PREDICTION_WINDOW_MS
  const predictionWalletOpen = roundElapsedMs < PREDICTION_WINDOW_MS - PREDICTION_WALLET_CONFIRM_BUFFER_MS

  useEffect(() => {
    let mounted = true

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

  const resultSheetStyle = useAnimatedStyle(() => ({
    opacity: resultSheetOpacity.value,
    transform: [{ translateY: resultSheetTranslateY.value }],
  }))

  const address = getWalletAddress(account)
  const connected = isWalletConnected(account)
  const walletAvatar = getWalletAvatar(address)
  const chartWidth = Math.max(300, Math.min(screenWidth - 20, 430))
  const chartPlotWidth = Math.max(224, chartWidth - CHART_AXIS_WIDTH)
  const selectedPoolMarketData = selectedPool ? poolMarketData[selectedPool.id] : undefined
  const selectedPoolPrice = selectedPool ? (selectedPoolMarketData?.price ?? selectedPool.currentPrice) : 0
  const selectedPoolChartPoints = selectedPool
    ? selectedPoolMarketData?.chartPoints.length
      ? selectedPoolMarketData.chartPoints
      : getFallbackChartPoints([selectedPool.currentPrice], roundStartMs)
    : []
  const selectedPoolDisplayChartPoints = selectedPool
    ? getChartDisplayPoints(selectedPoolChartPoints, selectedPoolPrice, nowMs)
    : []
  const activePrediction = selectedPool ? poolPredictions[selectedPool.id] : undefined
  const preparedPrediction = selectedPool ? preparedPredictions[selectedPool.id] : undefined
  const magicBlockPredictionReady =
    AppConfig.magicBlock.enabled && Boolean(preparedPrediction && preparedPrediction.expiresAtMs > nowMs)
  const currentRoundStartPrice = selectedPoolDisplayChartPoints[0]?.price ?? selectedPoolPrice
  const roundStartPrice = activePrediction?.roundStartPrice ?? currentRoundStartPrice
  const chartRangeValues = getChartRangeValues(selectedPoolDisplayChartPoints)
  const { max: chartMax, min: chartMin } = getChartPriceRange(
    chartRangeValues,
    selectedPoolPrice,
    selectedPool?.id,
    roundStartPrice,
  )
  const currentLineY = selectedPool ? getChartY(selectedPoolPrice, chartMin, chartMax) : 0
  const chartSegments = getLiveChartSegments(
    selectedPoolDisplayChartPoints,
    chartPlotWidth,
    chartMin,
    chartMax,
    roundStartMs,
  )
  const latestChartPoint = selectedPoolDisplayChartPoints[selectedPoolDisplayChartPoints.length - 1]
  const latestChartX = latestChartPoint ? getChartX(latestChartPoint.timestamp, roundStartMs, chartPlotWidth) : 0
  const latestChartY = latestChartPoint ? getChartY(latestChartPoint.price, chartMin, chartMax) : currentLineY
  const axisPrices = getAxisPrices(chartMin, chartMax)
  const axisTickSize = axisPrices.length > 1 ? Math.abs(axisPrices[0] - axisPrices[1]) : 0
  const phaseBoundaryX = chartPlotWidth / 2
  const tileLayouts = selectedPool
    ? getTileLayouts(chartPlotWidth, chartMin, chartMax, roundStartPrice, selectedPool.id)
    : {}
  const activePredictionEndsAtMs = getPredictionEndsAtMs(activePrediction)
  const activePredictionSettled = activePredictionEndsAtMs !== null && nowMs >= activePredictionEndsAtMs
  const roundSettled = activePredictionSettled
  const settlementFinalPrice = activePrediction?.settledFinalPrice ?? selectedPoolPrice
  const winningTileIndex = roundSettled
    ? (activePrediction?.winningTileIndex ??
      (selectedPool ? getTileIndexFromPrice(roundStartPrice, settlementFinalPrice, selectedPool.id) : null))
    : null
  const activePredictionWon =
    activePrediction && winningTileIndex !== null ? activePrediction.tileIndex === winningTileIndex : false
  const activePredictionPayout = activePrediction ? getPayoutAmount(activePrediction.multiplierBps) : 0
  const activePredictionPayoutBaseUnits = activePrediction ? getPayoutBaseUnits(activePrediction.multiplierBps) : 0n
  const activePredictionCoreRange =
    activePrediction && selectedPool
      ? getTilePriceRange(activePrediction.roundStartPrice, activePrediction.tileIndex, selectedPool.id)
      : null

  useEffect(() => {
    if (!selectedPool) {
      return
    }

    if (reduceMotion) {
      chartLiveX.value = latestChartX
      chartLiveY.value = latestChartY
      chartPulse.value = 1
      return
    }

    chartLiveX.value = withTiming(latestChartX, { duration: 400, easing: Easing.inOut(Easing.cubic) })
    chartLiveY.value = withTiming(latestChartY, { duration: 400, easing: Easing.inOut(Easing.cubic) })
    chartPulse.value = withSequence(
      withTiming(1.16, { duration: 150, easing: Easing.out(Easing.cubic) }),
      withSpring(1, { damping: 14, stiffness: 180 }),
    )
  }, [chartLiveX, chartLiveY, chartPulse, latestChartX, latestChartY, reduceMotion, selectedPool, selectedPoolPrice])

  const chartGuideStyle = useAnimatedStyle(() => ({
    top: chartLiveY.value,
  }))

  const chartCurrentDotHaloStyle = useAnimatedStyle(() => ({
    left: chartLiveX.value - 18,
    top: chartLiveY.value - 18,
    transform: [{ scale: chartPulse.value }],
  }))

  const chartCurrentDotStyle = useAnimatedStyle(() => ({
    left: chartLiveX.value - 11,
    top: chartLiveY.value - 11,
    transform: [{ scale: chartPulse.value }],
  }))

  const chartPriceTagStyle = useAnimatedStyle(() => ({
    top: chartLiveY.value - 17,
  }))

  useEffect(() => {
    if (!isWalletSheetOpen || !connected || !address) {
      setWalletSolBalance(null)
      setWalletUsdcBalance(null)
      setWalletBalanceLoading(false)
      setWalletBalanceError('')
      return
    }

    let mounted = true
    setWalletBalanceLoading(true)
    setWalletBalanceError('')

    const solBalancePromise = client.rpc.getBalance(solanaAddress(address)).send()
    const usdcBalancePromise = AppConfig.devnetUsdcMint
      ? client.rpc
          .getAccountInfo(solanaAddress(getUserTokenAccountAddress(address, AppConfig.devnetUsdcMint)), {
            encoding: 'base64',
          })
          .send()
      : Promise.resolve(null)

    Promise.all([solBalancePromise, usdcBalancePromise])
      .then(([solBalance, usdcAccount]) => {
        if (mounted) {
          setWalletSolBalance(lamportsToSol(solBalance.value))
          setWalletUsdcBalance(usdcAccount?.value ? Number(getSplTokenAccountAmount(usdcAccount.value)) / 1_000_000 : 0)
        }
      })
      .catch(() => {
        if (mounted) {
          setWalletBalanceError('Balance unavailable')
          setWalletSolBalance(null)
          setWalletUsdcBalance(null)
        }
      })
      .finally(() => {
        if (mounted) {
          setWalletBalanceLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [address, client.rpc, connected, isWalletSheetOpen])

  useEffect(() => {
    if (!selectedPool || !activePrediction || !roundSettled || activePrediction.feedbackShown) {
      return
    }

    const settledFinalPrice = selectedPoolPrice
    const settledWinningTileIndex = getTileIndexFromPrice(roundStartPrice, settledFinalPrice, selectedPool.id)
    const settledPredictionWon = activePrediction.tileIndex === settledWinningTileIndex
    const feedback: ResultFeedback = settledPredictionWon
      ? {
          message: `Nice call. You won ${formatUsdcAmount(activePredictionPayout)}, and the payout is being sent to your USDC account.`,
          settledAtMs: Date.now(),
          title: 'Your tick won',
          type: 'win',
        }
      : {
          message: 'Your tile landed outside the final price range. No payout this round, but the next window is already moving.',
          settledAtMs: Date.now(),
          title: 'You lost',
          type: 'lose',
        }

    setPoolPredictions((predictions) => {
      const currentPrediction = predictions[selectedPool.id]

      if (currentPrediction?.roundId !== activePrediction.roundId) {
        return predictions
      }

      return {
        ...predictions,
        [selectedPool.id]: {
          ...currentPrediction,
          feedbackShown: true,
          settledFinalPrice,
          winningTileIndex: settledWinningTileIndex,
        },
      }
    })
    setResultFeedback(feedback)
    setPredictionStatus(settledPredictionWon ? 'Win locked. Opening wallet to disburse your payout.' : '')
    playWebResultMusic(feedback.type)

    if (feedback.type === 'win') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)
      Vibration.vibrate(WIN_VIBRATION_PATTERN)
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined)
      Vibration.vibrate(LOSE_VIBRATION_PATTERN)
    }
  }, [activePrediction, activePredictionPayout, roundSettled, roundStartPrice, selectedPool, selectedPoolPrice])

  useEffect(() => {
    if (!selectedPool || !activePrediction?.feedbackShown || !roundSettled || activePredictionWon) {
      return
    }

    const resetTimer = setTimeout(() => {
      clearPoolPrediction(setPoolPredictions, selectedPool.id, activePrediction.roundId)
      setPredictionStatus('')
    }, RESULT_SHEET_FEEDBACK_MS + 450)

    return () => clearTimeout(resetTimer)
  }, [activePrediction?.feedbackShown, activePrediction?.roundId, activePredictionWon, roundSettled, selectedPool])

  function openWalletAction() {
    setWalletSheetOpen(true)
  }

  async function connectWallet() {
    setWalletSheetOpen(false)

    if (connected) {
      await disconnect()
    }

    await connect()
  }

  function copyAddress() {
    Clipboard.setString(address)
    setCopyLabel('Copied')
    setTimeout(() => setCopyLabel('Copy Address'), 1400)
  }

  function disconnectWallet() {
    setWalletSheetOpen(false)
    disconnect()
  }

  async function sendSessionInstructions(instructions: Instruction[], sessionKeypair: Keypair, rpcUrl: string) {
    const connection = new Connection(rpcUrl, 'confirmed')
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    const transaction = new Transaction({
      feePayer: sessionKeypair.publicKey,
      recentBlockhash: blockhash,
    }).add(...instructions.map(kitInstructionToWeb3Instruction))

    transaction.sign(sessionKeypair)
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
    })

    await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, 'confirmed')
    return signature
  }

  async function sendMagicBlockErInstruction(instruction: Instruction, sessionKeypair: Keypair) {
    return sendSessionInstructions([instruction], sessionKeypair, AppConfig.magicBlock.routerRpcUrl || AppConfig.solanaDevnetRpcUrl)
  }

  async function confirmDevnetTransaction(signature: string) {
    const connection = new Connection(AppConfig.solanaDevnetRpcUrl, 'confirmed')
    await connection.confirmTransaction(signature, 'confirmed')
  }

  async function topUpSessionSolFromHouseWallet(sessionAuthorityAddress: string) {
    const houseWallet = getDevnetHouseWalletKeypair()

    if (!houseWallet) {
      throw new Error('Set EXPO_PUBLIC_DEVNET_HOUSE_WALLET_SECRET_KEY so the house wallet can sponsor MagicBlock session fees.')
    }

    const connection = new Connection(AppConfig.solanaDevnetRpcUrl, 'confirmed')
    const houseBalance = await connection.getBalance(houseWallet.publicKey)

    if (houseBalance < MAGICBLOCK_SESSION_SPONSOR_LAMPORTS) {
      throw new Error(
        `Devnet house wallet ${shortenAddress(
          houseWallet.publicKey.toBase58(),
          6,
        )} needs at least ${lamportsToSol(
          BigInt(MAGICBLOCK_SESSION_SPONSOR_LAMPORTS),
        )} devnet SOL to sponsor MagicBlock fees.`,
      )
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    const transaction = new Transaction({
      feePayer: houseWallet.publicKey,
      recentBlockhash: blockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey: houseWallet.publicKey,
        lamports: MAGICBLOCK_SESSION_SPONSOR_LAMPORTS,
        toPubkey: new PublicKey(sessionAuthorityAddress),
      }),
    )

    transaction.sign(houseWallet)
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
    })

    await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, 'confirmed')
  }

  async function ensureMagicBlockSessionSol(sessionKeypair: Keypair) {
    const sessionAuthorityAddress = sessionKeypair.publicKey.toBase58()
    const sessionSolBalance = await client.rpc.getBalance(solanaAddress(sessionAuthorityAddress)).send()

    if (sessionSolBalance.value >= BigInt(MAGICBLOCK_MIN_SESSION_LAMPORTS)) {
      return
    }

    setPredictionStatus('MagicBlock session fee balance is low. Refilling from house wallet...')
    await topUpSessionSolFromHouseWallet(sessionAuthorityAddress)

    const updatedSessionSolBalance = await client.rpc.getBalance(solanaAddress(sessionAuthorityAddress)).send()

    if (updatedSessionSolBalance.value < BigInt(MAGICBLOCK_MIN_SESSION_LAMPORTS)) {
      throw new Error('MagicBlock session SOL refill is still confirming. Try the tile again in a few seconds.')
    }
  }

  async function prepareMagicBlockPrediction() {
    const activePool = selectedPool

    if (
      !activePool ||
      !AppConfig.magicBlock.enabled ||
      preparePendingPoolId !== null ||
      (activePrediction && !activePredictionSettled)
    ) {
      return
    }

    if (magicBlockPredictionReady) {
      setPredictionStatus('MagicBlock session ready. Tap tiles in this or future rounds.')
      return
    }

    setPreparePendingPoolId(activePool.id)
    setPredictionStatus('Opening wallet to pre-fund a reusable MagicBlock session...')

    try {
      const usdcMintAddress = getConfiguredUsdcMint()
      const walletAccount = account ?? (await connect())
      const predictorAddress = getWalletAddress(walletAccount)

      if (!predictorAddress) {
        throw new Error('Wallet connection did not return an address.')
      }

      const programAccount = await client.rpc
        .getAccountInfo(solanaAddress(TICK_PREDICTION_PROGRAM_ID), { encoding: 'base64' })
        .send()

      if (!programAccount.value) {
        throw new Error('Tick is not deployed on devnet. Deploy the program before using MagicBlock.')
      }

      const sessionKeypair = Keypair.generate()
      const sessionAuthorityAddress = sessionKeypair.publicKey.toBase58()
      const sessionExpiresAtMs = Date.now() + AppConfig.magicBlock.sessionTtlSeconds * 1000
      setPredictionStatus('Funding MagicBlock session fees from house wallet...')
      await topUpSessionSolFromHouseWallet(sessionAuthorityAddress)

      const addresses = getTickPredictionAddresses(activePool.symbol, predictorAddress, BigInt(roundStartMs), usdcMintAddress)
      const sessionUsdcAccountAddress = getUserTokenAccountAddress(sessionAuthorityAddress, usdcMintAddress)
      const poolAccount = await client.rpc.getAccountInfo(solanaAddress(addresses.pool), { encoding: 'base64' }).send()
      const usdcMintAccount = await client.rpc
        .getAccountInfo(solanaAddress(usdcMintAddress), { encoding: 'base64' })
        .send()
      const userUsdcAccount = addresses.predictorTokenAccount
        ? await client.rpc.getAccountInfo(solanaAddress(addresses.predictorTokenAccount), { encoding: 'base64' }).send()
        : null
      const sessionUsdcAccount = await client.rpc
        .getAccountInfo(solanaAddress(sessionUsdcAccountAddress), { encoding: 'base64' })
        .send()
      const instructions: Instruction[] = []

      if (!addresses.predictorTokenAccount) {
        throw new Error('Could not derive your USDC token account.')
      }

      const usdcDecimals = getSplMintDecimals(usdcMintAccount.value)

      if (usdcDecimals !== 6) {
        throw new Error(
          `EXPO_PUBLIC_DEVNET_USDC_MINT must be a 6-decimal devnet token. Current mint has ${
            usdcDecimals ?? 'unknown'
          } decimals.`,
        )
      }

      if (!userUsdcAccount?.value) {
        throw new Error(
          `Your wallet needs devnet USDC for this game. Create and mint at least $1 of ${shortenAddress(
            usdcMintAddress,
            6,
          )} before predicting.`,
        )
      }

      const sessionStakeAmount = TILE_STAKE_BASE_UNITS * MAGICBLOCK_SESSION_PREDICTION_CREDITS

      if (getSplTokenAccountAmount(userUsdcAccount.value) < sessionStakeAmount) {
        throw new Error(
          `Your devnet USDC balance is below ${formatUsdcBaseUnits(
            sessionStakeAmount,
          )}. Mint more ${shortenAddress(usdcMintAddress, 6)} before starting a MagicBlock session.`,
        )
      }

      if (!poolAccount.value) {
        instructions.push(
          getInitializePoolInstruction({
            authorityAddress: predictorAddress,
            symbol: activePool.symbol,
            usdcMintAddress,
          }),
        )
      }

      if (!sessionUsdcAccount.value) {
        instructions.push(
          getCreateUserUsdcAccountInstruction({
            ownerAddress: sessionAuthorityAddress,
            payerAddress: predictorAddress,
            usdcMintAddress,
          }),
        )
      }

      instructions.push(
        getTransferUsdcInstruction({
          amount: sessionStakeAmount,
          authorityAddress: predictorAddress,
          destinationOwnerAddress: sessionAuthorityAddress,
          sourceOwnerAddress: predictorAddress,
          usdcMintAddress,
        }),
        getAuthorizePoolSessionInstruction({
          authorityAddress: predictorAddress,
          expiresAt: BigInt(Math.floor(sessionExpiresAtMs / 1000)),
          sessionAuthorityAddress,
          symbol: activePool.symbol,
        }),
      )

      const signature = await sendTransactions(instructions)
      await confirmDevnetTransaction(signature)

      setPreparedPredictions((predictions) => ({
        ...predictions,
        [activePool.id]: {
          authorityAddress: predictorAddress,
          expiresAtMs: sessionExpiresAtMs,
          sessionKeypair,
        },
      }))
      setPredictionStatus(`MagicBlock session funded for ${MAGICBLOCK_SESSION_PREDICTION_CREDITS} rounds: ${shortenAddress(signature, 6)}`)
    } catch (error) {
      if (isUserCancelledError(error)) {
        return
      }

      const message = error instanceof Error ? error.message : 'Could not prepare MagicBlock prediction.'
      setPredictionStatus(message)
    } finally {
      setPreparePendingPoolId(null)
    }
  }

  async function selectMagicBlockTile(tileIndex: number) {
    const activePool = selectedPool
    const prepared = selectedPool ? preparedPredictions[selectedPool.id] : undefined

    if (!activePool || pendingTileIndex !== null || (activePrediction && !activePredictionSettled)) {
      return
    }

    if (!predictionOpen) {
      setPredictionStatus('Prediction is closed for this round. Settlement is in progress.')
      return
    }

    if (!prepared || prepared.expiresAtMs <= nowMs) {
      setPredictionStatus('Press Predict once to start a reusable MagicBlock session.')
      return
    }

    setPendingTileIndex(tileIndex)
    setPredictionStatus('Funding this round from your MagicBlock session...')

    try {
      const usdcMintAddress = getConfiguredUsdcMint()
      const predictorAddress = prepared.authorityAddress
      const sessionAuthorityAddress = prepared.sessionKeypair.publicKey.toBase58()
      await ensureMagicBlockSessionSol(prepared.sessionKeypair)

      const activeMarketData = poolMarketData[activePool.id]
      const activePrice = activeMarketData?.price ?? activePool.currentPrice
      const roundStartPrice = activeMarketData?.chartPoints[0]?.price ?? activePrice
      const roundId = BigInt(roundStartMs)
      const startsAt = BigInt(Math.floor(roundStartMs / 1000))
      const endsAt = BigInt(Math.floor(roundEndMs / 1000))
      const addresses = getTickPredictionAddresses(activePool.symbol, predictorAddress, roundId, usdcMintAddress)
      const roundAccount = await client.rpc
        .getAccountInfo(solanaAddress(addresses.round), { encoding: 'base64' })
        .send()
      const setupInstructions: Instruction[] = []

      if (!roundAccount.value) {
        setupInstructions.push(
          getOpenRoundWithSessionInstruction({
            authorityAddress: predictorAddress,
            endsAt,
            roundId,
            sessionAuthorityAddress,
            startPrice: getPoolStartPrice(roundStartPrice),
            startsAt,
            symbol: activePool.symbol,
          }),
        )
      }

      setupInstructions.push(
        getFundPredictionInstruction({
          payerAddress: sessionAuthorityAddress,
          predictorAddress,
          roundId,
          sessionAuthorityAddress,
          symbol: activePool.symbol,
          usdcMintAddress,
        }),
        getDelegatePredictionInstruction({
          payerAddress: sessionAuthorityAddress,
          predictorAddress,
          roundId,
          symbol: activePool.symbol,
          validatorAddress: AppConfig.magicBlock.erValidator,
        }),
      )

      if (!roundAccount.value) {
        setupInstructions.push(
          getDelegateRoundInstruction({
            payerAddress: sessionAuthorityAddress,
            roundId,
            symbol: activePool.symbol,
            validatorAddress: AppConfig.magicBlock.erValidator,
          }),
        )
      }

      await sendSessionInstructions(setupInstructions, prepared.sessionKeypair, AppConfig.solanaDevnetRpcUrl)
      setPredictionStatus('Sending tile to MagicBlock...')

      const signature = await sendMagicBlockErInstruction(
        getSelectTileOnErInstruction({
          predictorAddress,
          roundId,
          sessionAuthorityAddress,
          symbol: activePool.symbol,
          tileIndex,
        }),
        prepared.sessionKeypair,
      )

      setPoolPredictions((predictions) => ({
        ...predictions,
        [activePool.id]: {
          multiplierBps: TILE_MULTIPLIERS_BPS[tileIndex],
          roundId,
          roundStartPrice,
          tileIndex,
        },
      }))
      setPredictionStatus(
        `${formatMultiplier(TILE_MULTIPLIERS_BPS[tileIndex])} locked via MagicBlock: ${shortenAddress(signature, 6)}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not select tile on MagicBlock.'
      setPredictionStatus(message)
    } finally {
      setPendingTileIndex(null)
    }
  }

  async function placeTilePrediction(tileIndex: number) {
    const activePool = selectedPool
    if (!activePool || pendingTileIndex !== null || (activePrediction && !activePredictionSettled)) {
      return
    }

    if (!predictionWalletOpen) {
      setPredictionStatus('This round is almost closed. Wait a few seconds for the next prediction window.')
      return
    }

    setPendingTileIndex(tileIndex)
    setPredictionStatus('')

    try {
      const usdcMintAddress = getConfiguredUsdcMint()
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
      const addresses = getTickPredictionAddresses(activePool.symbol, predictorAddress, roundId, usdcMintAddress)
      const poolAccount = await client.rpc.getAccountInfo(solanaAddress(addresses.pool), { encoding: 'base64' }).send()
      const roundAccount = await client.rpc
        .getAccountInfo(solanaAddress(addresses.round), { encoding: 'base64' })
        .send()
      const usdcMintAccount = await client.rpc
        .getAccountInfo(solanaAddress(usdcMintAddress), { encoding: 'base64' })
        .send()
      const userUsdcAccount = addresses.predictorTokenAccount
        ? await client.rpc.getAccountInfo(solanaAddress(addresses.predictorTokenAccount), { encoding: 'base64' }).send()
        : null
      const instructions: Instruction[] = []

      if (!addresses.predictorTokenAccount) {
        throw new Error('Could not derive your USDC token account.')
      }

      const usdcDecimals = getSplMintDecimals(usdcMintAccount.value)

      if (usdcDecimals !== 6) {
        throw new Error(
          `EXPO_PUBLIC_DEVNET_USDC_MINT must be a 6-decimal devnet token. Current mint has ${
            usdcDecimals ?? 'unknown'
          } decimals.`,
        )
      }

      if (!userUsdcAccount?.value) {
        throw new Error(
          `Your wallet needs devnet USDC for this game. Create and mint at least $1 of ${shortenAddress(
            usdcMintAddress,
            6,
          )} before predicting.`,
        )
      }

      if (getSplTokenAccountAmount(userUsdcAccount.value) < 1_000_000n) {
        throw new Error(
          `Your devnet USDC balance is below $1. Mint more ${shortenAddress(usdcMintAddress, 6)} before predicting.`,
        )
      }

      if (!poolAccount.value) {
        instructions.push(
          getInitializePoolInstruction({
            authorityAddress: predictorAddress,
            symbol: activePool.symbol,
            usdcMintAddress,
          }),
        )
      }

      if (!roundAccount.value) {
        instructions.push(
          getOpenRoundInstruction({
            authorityAddress: predictorAddress,
            endsAt,
            roundId,
            startPrice: getPoolStartPrice(roundStartPrice),
            startsAt,
            symbol: activePool.symbol,
          }),
        )
      }

      instructions.push(
        getPlaceTilePredictionInstruction({
          predictorAddress,
          roundId,
          symbol: activePool.symbol,
          tileIndex,
          usdcMintAddress,
        }),
      )

      const signature = await sendTransactions(instructions)

      setPoolPredictions((predictions) => ({
        ...predictions,
        [activePool.id]: {
          multiplierBps: TILE_MULTIPLIERS_BPS[tileIndex],
          roundId,
          roundStartPrice,
          tileIndex,
        },
      }))
      setPredictionStatus(
        `${formatMultiplier(TILE_MULTIPLIERS_BPS[tileIndex])} placed for $1 via ${getPredictionRouteLabel()}: ${shortenAddress(
          signature,
          6,
        )}`,
      )
    } catch (error) {
      if (isUserCancelledError(error)) {
        return
      }

      const message = error instanceof Error ? error.message : 'Could not place tile prediction.'
      setPredictionStatus(message)
    } finally {
      setPendingTileIndex(null)
    }
  }

  async function handleTilePress(tileIndex: number) {
    if (AppConfig.magicBlock.enabled) {
      await selectMagicBlockTile(tileIndex)
      return
    }

    await placeTilePrediction(tileIndex)
  }

  const claimTilePayout = useCallback(async () => {
    const activePool = selectedPool
    const prediction = activePrediction

    if (
      !activePool ||
      !prediction ||
      !activePredictionWon ||
      prediction.claimed ||
      claimPendingRoundId === prediction.roundId
    ) {
      return
    }

    setClaimPendingRoundId(prediction.roundId)
    setPredictionStatus('Opening wallet to send your payout claim...')

    try {
      const usdcMintAddress = getConfiguredUsdcMint()
      const walletAccount = account ?? (await connect())
      const claimantAddress = getWalletAddress(walletAccount)

      if (!claimantAddress) {
        throw new Error('Wallet connection did not return an address.')
      }

      const addresses = getTickPredictionAddresses(
        activePool.symbol,
        claimantAddress,
        prediction.roundId,
        usdcMintAddress,
      )
      const userUsdcAccount = addresses.predictorTokenAccount
      const instructions: Instruction[] = []

      if (!userUsdcAccount) {
        throw new Error('Could not derive your USDC token account.')
      }

      const userUsdcAccountInfo = await client.rpc
        .getAccountInfo(solanaAddress(userUsdcAccount), { encoding: 'base64' })
        .send()

      if (!userUsdcAccountInfo.value) {
        instructions.push(
          getCreateUserUsdcAccountInstruction({
            ownerAddress: claimantAddress,
            payerAddress: claimantAddress,
            usdcMintAddress,
          }),
        )
      }

      const vaultAccountInfo = await client.rpc
        .getAccountInfo(solanaAddress(addresses.vault), { encoding: 'base64' })
        .send()
      const vaultBalance = getSplTokenAccountAmount(vaultAccountInfo.value)

      if (vaultBalance < activePredictionPayoutBaseUnits) {
        throw new Error(
          `Pool vault only has ${formatUsdcBaseUnits(vaultBalance)} but this win needs ${formatUsdcBaseUnits(
            activePredictionPayoutBaseUnits,
          )}. Seed the ${activePool.symbol} vault before claiming.`,
        )
      }

      if (AppConfig.magicBlock.enabled) {
        setPredictionStatus('Committing your MagicBlock prediction back to Solana...')
        await sendTransactions([
          getUndelegatePredictionInstruction({
            claimantAddress,
            payerAddress: claimantAddress,
            roundId: prediction.roundId,
            symbol: activePool.symbol,
          }),
          getUndelegateRoundInstruction({
            payerAddress: claimantAddress,
            roundId: prediction.roundId,
            symbol: activePool.symbol,
          }),
        ])
      }

      instructions.push(
        getSettleRoundInstruction({
          authorityAddress: claimantAddress,
          finalPrice: getPoolStartPrice(prediction.settledFinalPrice ?? selectedPoolPrice),
          roundId: prediction.roundId,
          symbol: activePool.symbol,
        }),
        getClaimPayoutInstruction({
          authorityAddress: claimantAddress,
          claimantAddress,
          roundId: prediction.roundId,
          symbol: activePool.symbol,
          usdcMintAddress,
        }),
      )

      const signature = await sendTransactions(instructions)

      clearPoolPrediction(setPoolPredictions, activePool.id, prediction.roundId)
      setPredictionStatus(
        `Paid ${formatUsdcAmount(activePredictionPayout)} to your wallet: ${shortenAddress(signature, 6)}`,
      )
    } catch (error) {
      if (isUserCancelledError(error)) {
        return
      }

      const message = error instanceof Error ? error.message : 'Could not claim payout.'
      setPredictionStatus(message)
    } finally {
      setClaimPendingRoundId(null)
    }
  }, [
    account,
    activePrediction,
    activePredictionPayout,
    activePredictionPayoutBaseUnits,
    activePredictionWon,
    claimPendingRoundId,
    client.rpc,
    connect,
    selectedPool,
    selectedPoolPrice,
    sendTransactions,
  ])

  useEffect(() => {
    if (
      !selectedPool ||
      !activePrediction?.feedbackShown ||
      !activePredictionWon ||
      activePrediction.claimed ||
      activePrediction.autoClaimStarted
    ) {
      return
    }

    setPoolPredictions((predictions) => {
      const currentPrediction = predictions[selectedPool.id]

      if (currentPrediction?.roundId !== activePrediction.roundId) {
        return predictions
      }

      return {
        ...predictions,
        [selectedPool.id]: {
          ...currentPrediction,
          autoClaimStarted: true,
        },
      }
    })

    const autoClaimTimer = setTimeout(() => {
      claimTilePayout()
    }, RESULT_FEEDBACK_MS + 250)

    return () => clearTimeout(autoClaimTimer)
  }, [activePrediction, activePredictionWon, claimTilePayout, selectedPool])

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
                          backgroundColor: `${selectedPool.accent}24`,
                          borderLeftColor: `${selectedPool.accent}70`,
                          left: phaseBoundaryX,
                          width: chartPlotWidth - phaseBoundaryX,
                        },
                      ]}
                    />
                    <View
                      style={[
                        appStyles.priceChartPhaseDivider,
                        {
                          backgroundColor: selectedPool.accent,
                          left: phaseBoundaryX,
                        },
                      ]}
                    />
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
                          color: selectedPool.accent,
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
                    <Animated.View
                      style={[appStyles.priceChartGuideLine, { width: chartPlotWidth }, chartGuideStyle]}
                    />
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
                    <Animated.View
                      style={[
                        appStyles.priceChartCurrentDotHalo,
                        {
                          backgroundColor: selectedPool.accent,
                        },
                        chartCurrentDotHaloStyle,
                      ]}
                    />
                    <Animated.View
                      style={[
                        appStyles.priceChartCurrentDot,
                        {
                          backgroundColor: selectedPool.accent,
                          borderColor: `${selectedPool.accent}42`,
                        },
                        chartCurrentDotStyle,
                      ]}
                    />
                    {TILE_MULTIPLIERS_BPS.map((multiplierBps, tileIndex) => {
                      const tileSelected = activePrediction?.tileIndex === tileIndex
                      const tileWon = winningTileIndex === tileIndex && roundSettled
                      const tilePending = pendingTileIndex === tileIndex
                      const tileLayout = tileLayouts[tileIndex]
                      const tileDisabled =
                        !predictionOpen ||
                        Boolean(activePrediction && !activePredictionSettled) ||
                        pendingTileIndex !== null ||
                        preparePendingPoolId !== null ||
                        (AppConfig.magicBlock.enabled && !magicBlockPredictionReady)

                      return (
                        <Pressable
                          accessibilityLabel={`${formatMultiplier(multiplierBps)} tile aligned to the right price axis`}
                          accessibilityRole="button"
                          disabled={tileDisabled}
                          key={`tile-${tileIndex}`}
                          onPress={() => handleTilePress(tileIndex)}
                          style={({ pressed }) => [
                            appStyles.tileButton,
                            tileLayout,
                            pressed && appStyles.tileButtonPressed,
                            tileDisabled && !tileSelected && appStyles.tileButtonDisabled,
                            tileSelected && appStyles.tileButtonSelected,
                            tileWon && appStyles.tileButtonWinning,
                          ]}
                        >
                          <Text style={appStyles.tileMultiplierText}>
                            {tilePending ? '...' : formatMultiplier(multiplierBps)}
                          </Text>
                        </Pressable>
                      )
                    })}
                    {activePrediction ? (
                      <View
                        style={[
                          appStyles.priceChartPredictionPill,
                          {
                            left: Math.max(10, phaseBoundaryX + 8),
                            top: CHART_HEIGHT - CHART_PADDING - 40,
                          },
                        ]}
                      >
                        <Text style={appStyles.priceChartPredictionText}>
                          {formatMultiplier(activePrediction.multiplierBps)}
                        </Text>
                      </View>
                    ) : null}
                    <Animated.View
                      style={[
                        appStyles.priceChartPriceTag,
                        {
                          backgroundColor: selectedPool.accent,
                          right: 6,
                        },
                        chartPriceTagStyle,
                      ]}
                    >
                      <Text style={appStyles.priceChartPriceTagText}>{formatPoolPrice(selectedPoolPrice)}</Text>
                    </Animated.View>
                  </View>

                  <View style={appStyles.tileSummary}>
                    <View style={appStyles.tileSummaryItem}>
                      <Text style={appStyles.tileSummaryLabel}>STAKE</Text>
                      <Text style={appStyles.tileSummaryValue}>{formatUsdcAmount(TILE_STAKE_USDC)}</Text>
                    </View>
                    <View style={appStyles.tileSummaryItem}>
                      <Text style={appStyles.tileSummaryLabel}>WINDOW</Text>
                      <Text style={appStyles.tileSummaryValue}>{predictionOpen ? 'OPEN' : 'CLOSED'}</Text>
                    </View>
                    <View style={appStyles.tileSummaryItemWide}>
                      <Text style={appStyles.tileSummaryLabel}>ROUTE</Text>
                      <Text style={appStyles.tileSummaryValue}>{getPredictionRouteLabel()}</Text>
                    </View>
                  </View>
                  {AppConfig.magicBlock.enabled && !activePrediction ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={magicBlockPredictionReady || preparePendingPoolId !== null}
                      onPress={prepareMagicBlockPrediction}
                      style={({ pressed }) => [
                        appStyles.claimButton,
                        pressed && appStyles.buttonPressed,
                        (magicBlockPredictionReady || preparePendingPoolId !== null) && appStyles.tileButtonDisabled,
                      ]}
                    >
                      <Text style={appStyles.claimButtonText}>
                        {preparePendingPoolId === selectedPool.id
                          ? 'PREPARING...'
                          : magicBlockPredictionReady
                            ? 'READY'
                            : 'PREDICT'}
                      </Text>
                    </Pressable>
                  ) : null}
                  {activePrediction ? (
                    <View
                      style={[
                        appStyles.tileResultCard,
                        {
                          backgroundColor: `${selectedPool.accent}24`,
                          borderColor: selectedPool.accent,
                        },
                      ]}
                    >
                      <View style={appStyles.tileResultTextGroup}>
                        <Text style={[appStyles.tileResultLabel, { color: selectedPool.accent }]}>
                          {roundSettled && activePredictionWon
                            ? activePrediction.claimed
                              ? 'PAID'
                              : 'WIN'
                            : roundSettled
                              ? 'MISSED'
                              : predictionOpen
                                ? 'PREDICTION'
                                : 'LOCKED'}
                        </Text>
                        <Text style={appStyles.tileResultValue}>
                          {formatMultiplier(activePrediction.multiplierBps)}
                        </Text>
                        {activePredictionCoreRange ? (
                          <Text style={appStyles.tileAxisRangeValue}>
                            {formatAxisPrice(activePredictionCoreRange.lower, axisTickSize)} -{' '}
                            {formatAxisPrice(activePredictionCoreRange.upper, axisTickSize)}
                          </Text>
                        ) : null}
                      </View>
                      <View style={appStyles.tileMultiplierBadge}>
                        <Text style={appStyles.tileMultiplierBadgeText}>
                          {formatMultiplier(activePrediction.multiplierBps)}
                        </Text>
                      </View>
                      {roundSettled && activePredictionWon && !activePrediction.claimed ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={claimTilePayout}
                          style={({ pressed }) => [appStyles.claimButton, pressed && appStyles.buttonPressed]}
                        >
                          <Text style={appStyles.claimButtonText}>
                            CLAIM {formatUsdcAmount(activePredictionPayout)}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : (
                    <Text style={appStyles.predictionStatus}>
                      {predictionOpen
                        ? AppConfig.magicBlock.enabled && !magicBlockPredictionReady
                          ? 'Press Predict once, then tap tiles across rounds.'
                          : 'Tap one settlement tile before 30 seconds.'
                        : 'Prediction window closed.'}
                    </Text>
                  )}
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

          {resultFeedback ? (
            <View
              pointerEvents="none"
              style={[
                appStyles.resultFeedbackOverlay,
                resultFeedback.type === 'win' ? appStyles.resultFeedbackWin : appStyles.resultFeedbackLose,
              ]}
            >
              <Animated.View
                style={[
                  appStyles.resultFeedbackSheet,
                  resultFeedback.type === 'win' ? appStyles.resultFeedbackSheetWin : appStyles.resultFeedbackSheetLose,
                  resultSheetStyle,
                ]}
              >
                <View style={appStyles.resultFeedbackSheetHandle} />
                <View style={appStyles.resultFeedbackSheetHeader}>
                  <View
                    style={[
                      appStyles.resultFeedbackIcon,
                      resultFeedback.type === 'win' ? appStyles.resultFeedbackIconWin : appStyles.resultFeedbackIconLose,
                    ]}
                  >
                    <Ionicons
                      color={resultFeedback.type === 'win' ? '#b8ff66' : '#ff8b8b'}
                      name={resultFeedback.type === 'win' ? 'checkmark' : 'close'}
                      size={20}
                    />
                  </View>
                  <View style={appStyles.resultFeedbackCopy}>
                    <Text style={appStyles.resultFeedbackTitle}>{resultFeedback.title}</Text>
                    <Text style={appStyles.resultFeedbackDate}>{formatResultDate(resultFeedback.settledAtMs)}</Text>
                  </View>
                </View>
                <Text style={appStyles.resultFeedbackMessage}>{resultFeedback.message}</Text>
              </Animated.View>
            </View>
          ) : null}

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
                    <View style={appStyles.walletProfile}>
                      <View style={[appStyles.walletProfileAvatar, walletAvatar]}>
                        <Text style={appStyles.walletProfileAvatarText}>M</Text>
                      </View>
                      <View style={appStyles.walletProfileContent}>
                        <Pressable
                          accessibilityLabel={copyLabel === 'Copied' ? 'Wallet address copied' : 'Copy wallet address'}
                          accessibilityRole="button"
                          onPress={copyAddress}
                          style={appStyles.walletAddressCopyRow}
                        >
                          <Text numberOfLines={1} style={appStyles.walletProfileAddress}>
                            {shortenAddress(address)}
                          </Text>
                          <Ionicons
                            color={copyLabel === 'Copied' ? '#b8ff66' : '#a9a9a9'}
                            name={copyLabel === 'Copied' ? 'checkmark-outline' : 'copy-outline'}
                            size={20}
                          />
                        </Pressable>
                        <Text numberOfLines={1} adjustsFontSizeToFit style={appStyles.walletBalanceText}>
                          SOL : {walletBalanceLoading ? '...' : formatWalletTokenBalance(walletSolBalance)}
                        </Text>
                        <Text numberOfLines={1} adjustsFontSizeToFit style={appStyles.walletBalanceSubText}>
                          USDC : {walletBalanceLoading ? '...' : formatWalletTokenBalance(walletUsdcBalance)}
                        </Text>
                        {walletBalanceError ? (
                          <Text style={appStyles.walletBalanceError}>{walletBalanceError}</Text>
                        ) : null}
                      </View>
                    </View>
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
