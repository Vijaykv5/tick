import { Text } from 'react-native'
import { ellipsify } from '@/utils/ellipsify'
import { useNetworkGetGenesisHash } from './use-network-get-genesis-hash'
import { appStyles } from '@/constants/app-styles'

export function NetworkFeatureGetGenesisHash() {
  const { data, isLoading } = useNetworkGetGenesisHash()

  return <Text style={appStyles.text}>Genesis Hash: {isLoading ? 'Loading...' : `${ellipsify(data, 8)}`}</Text>
}
