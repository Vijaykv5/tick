import { AccessibilityInfo, Linking, Modal, Pressable, Text, View } from 'react-native'
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

export default function HomeScreen() {
  const { account, connect, disconnect } = useMobileWallet()
  const [showApp, setShowApp] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [isWalletSheetOpen, setWalletSheetOpen] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Copy Address')
  const ticOpacity = useSharedValue(0)
  const ticTranslateY = useSharedValue(18)
  const kOpacity = useSharedValue(0)
  const kScale = useSharedValue(0.42)
  const kTranslateX = useSharedValue(-12)
  const contentOpacity = useSharedValue(0)

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
  }, [])

  useEffect(() => {
    if (reduceMotion) {
      ticOpacity.value = 1
      ticTranslateY.value = 0
      kOpacity.value = 1
      kScale.value = 1
      kTranslateX.value = 0
      setShowApp(true)
      contentOpacity.value = 1
      return
    }

    ticOpacity.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.cubic) })
    ticTranslateY.value = withTiming(0, { duration: 250, easing: Easing.out(Easing.cubic) })
    kOpacity.value = withDelay(280, withTiming(1, { duration: 150, easing: Easing.out(Easing.cubic) }))
    kTranslateX.value = withDelay(280, withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) }))
    kScale.value = withDelay(
      280,
      withSequence(
        withSpring(1.14, { damping: 9, stiffness: 150 }),
        withSpring(1, { damping: 13, stiffness: 170 }),
      ),
    )
    const showAppTimer = setTimeout(() => setShowApp(true), 1100)

    return () => clearTimeout(showAppTimer)
  }, [contentOpacity, kOpacity, kScale, kTranslateX, reduceMotion, ticOpacity, ticTranslateY])

  useEffect(() => {
    if (!showApp || reduceMotion) {
      return
    }

    contentOpacity.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.cubic) })
  }, [contentOpacity, reduceMotion, showApp])

  const ticStyle = useAnimatedStyle(() => ({
    opacity: ticOpacity.value,
    transform: [{ translateY: ticTranslateY.value }],
  }))

  const kStyle = useAnimatedStyle(() => ({
    opacity: kOpacity.value,
    transform: [{ translateX: kTranslateX.value }, { scale: kScale.value }],
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

  return (
    <SafeAreaView style={appStyles.screen}>
      {!showApp ? (
        <View style={appStyles.splash}>
          <View style={appStyles.splashWord}>
            <Animated.View style={[appStyles.splashLogoMark, ticStyle]}>
              <Text style={appStyles.splashLogoMarkText}>t</Text>
            </Animated.View>
            <Animated.Text style={[appStyles.splashIck, kStyle]}>ick</Animated.Text>
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

            <View style={appStyles.poolHeader}>
              <View style={appStyles.poolSide}>
                <Text style={appStyles.poolAsset}>BTC</Text>
                <Text style={appStyles.poolPrice}>$64,174.06</Text>
              </View>
              <View style={appStyles.poolDivider} />
              <View style={[appStyles.poolSide, appStyles.poolSideRight]}>
                <Text style={appStyles.poolPredictLabel}>PREDICT</Text>
                <Text style={appStyles.poolTimer}>18s</Text>
              </View>
              <View style={appStyles.poolAccent} />
            </View>
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
                    <Pressable accessibilityRole="button" onPress={disconnectWallet} style={appStyles.sheetActionDanger}>
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
