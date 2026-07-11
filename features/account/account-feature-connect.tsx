import React from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { AppButton } from '@/components/app-button'

export function AccountFeatureConnect() {
  const { account, connect } = useMobileWallet()

  return <AppButton disabled={!!account} title="Connect" onPress={connect} />
}
