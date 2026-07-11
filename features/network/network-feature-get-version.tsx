import { Text } from 'react-native'
import { useNetworkGetVersion } from './use-network-get-version'
import { appStyles } from '@/constants/app-styles'

export function NetworkFeatureGetVersion() {
  const { data, isLoading } = useNetworkGetVersion()

  return <Text style={appStyles.text}>Version: {isLoading ? 'Loading...' : `${data?.core} (${data?.features})`}</Text>
}
