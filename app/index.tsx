import {
  AccessibilityInfo,
  Image,
  ImageSourcePropType,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
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
import {
  getSolscanAccountUrl,
  getWalletAddress,
  getWalletAvatar,
  isWalletConnected,
  shortenAddress,
} from '@/utils/wallet'
import { address as solanaAddress, type Instruction } from '@solana/kit'
import {
  DEFAULT_ROUND_DURATION_SECONDS,
  getInitializePoolInstruction,
  getOpenRoundInstruction,
  getPlacePredictionInstruction,
  getTickPredictionAddresses,
  TICK_PREDICTION_PROGRAM_ID,
  type PredictionDirection,
} from '@/features/tick-prediction/tick-prediction-client'

type Pool = {
  accent: string
  id: 'btc' | 'sol' | 'eth'
  logo: ImageSourcePropType
  name: string
  price: string
  symbol: string
}

const POOLS: Pool[] = [
  {
    accent: '#ff9d17',
    id: 'btc',
    logo: require('../assets/images/btc.webp'),
    name: 'btc daily dash',
    price: '$64,174.06',
    symbol: 'BTC',
  },
  {
    accent: '#8d6bff',
    id: 'sol',
    logo: require('../assets/images/sol.webp'),
    name: 'sol daily dash',
    price: '$142.31',
    symbol: 'SOL',
  },
  {
    accent: '#79a7ff',
    id: 'eth',
    logo: require('../assets/images/eth.webp'),
    name: 'eth daily dash',
    price: '$3,312.44',
    symbol: 'ETH',
  },
]

export default function HomeScreen() {
  const { account, client, connect, disconnect, sendTransactions } = useMobileWallet()
  const [showApp, setShowApp] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [isWalletSheetOpen, setWalletSheetOpen] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Copy Address')
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null)
  const [predictionStatus, setPredictionStatus] = useState('')
  const [pendingDirection, setPendingDirection] = useState<PredictionDirection | null>(null)
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
  const avatarStyle = connected ? getWalletAvatar(address) : undefined

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

  function getPoolStartPrice(pool: Pool) {
    return BigInt(Math.max(1, Math.round(Number(pool.price.replace(/[$,]/g, '')) * 100)))
  }

  async function placePrediction(direction: PredictionDirection) {
    const activePool = selectedPool
    if (!activePool || pendingDirection) {
      return
    }

    setPendingDirection(direction)
    setPredictionStatus('')

    try {
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

      const roundId = BigInt(Date.now())
      const now = BigInt(Math.floor(Date.now() / 1000))
      const startsAt = now - 5n
      const endsAt = startsAt + DEFAULT_ROUND_DURATION_SECONDS
      const addresses = getTickPredictionAddresses(activePool.symbol, predictorAddress, roundId)
      const poolAccount = await client.rpc.getAccountInfo(solanaAddress(addresses.pool), { encoding: 'base64' }).send()
      const instructions: Instruction[] = []

      if (!poolAccount.value) {
        instructions.push(
          getInitializePoolInstruction({
            authorityAddress: predictorAddress,
            symbol: activePool.symbol,
          }),
        )
      }

      instructions.push(
        getOpenRoundInstruction({
          authorityAddress: predictorAddress,
          endsAt,
          roundId,
          startPrice: getPoolStartPrice(activePool),
          startsAt,
          symbol: activePool.symbol,
        }),
      )

      instructions.push(
        getPlacePredictionInstruction({
          direction,
          predictorAddress,
          roundId,
          symbol: activePool.symbol,
        }),
      )

      const signature = await sendTransactions(instructions)

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
                    <View style={[appStyles.walletAvatar, avatarStyle]}>
                      <View style={appStyles.walletAvatarDot} />
                    </View>
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
                    <Text style={[appStyles.poolPrice, { color: selectedPool.accent }]}>{selectedPool.price}</Text>
                  </View>
                  <View style={appStyles.poolDivider} />
                  <View style={[appStyles.poolSide, appStyles.poolSideRight]}>
                    <Text style={appStyles.poolPredictLabel}>PREDICT</Text>
                    <Text style={appStyles.poolTimer}>18s</Text>
                  </View>
                  <View style={appStyles.poolAccent} />
                </View>

                <View style={appStyles.poolDetailBody}>
                  <View style={[appStyles.poolLogoLarge, { borderColor: selectedPool.accent }]}>
                    <Image source={selectedPool.logo} style={appStyles.poolLogoLargeImage} />
                  </View>
                  <Text style={appStyles.poolDetailTitle}>{selectedPool.name}</Text>
                  <Text style={appStyles.poolDetailMeta}>1 min prediction round</Text>
                  <View style={appStyles.predictionActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={Boolean(pendingDirection)}
                      onPress={() => placePrediction('up')}
                      style={({ pressed }) => [
                        appStyles.predictionButton,
                        appStyles.predictionButtonUp,
                        pressed && appStyles.poolCardPressed,
                        pendingDirection && appStyles.predictionButtonDisabled,
                      ]}
                    >
                      <Ionicons color="#000000" name="trending-up" size={20} />
                      <Text style={appStyles.predictionButtonText}>{pendingDirection === 'up' ? 'sending' : 'up'}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={Boolean(pendingDirection)}
                      onPress={() => placePrediction('down')}
                      style={({ pressed }) => [
                        appStyles.predictionButton,
                        appStyles.predictionButtonDown,
                        pressed && appStyles.poolCardPressed,
                        pendingDirection && appStyles.predictionButtonDisabled,
                      ]}
                    >
                      <Ionicons color="#ffffff" name="trending-down" size={20} />
                      <Text style={[appStyles.predictionButtonText, appStyles.predictionButtonTextLight]}>
                        {pendingDirection === 'down' ? 'sending' : 'down'}
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
                      <Text style={appStyles.poolCardPrice}>Current price : {pool.price}</Text>
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
