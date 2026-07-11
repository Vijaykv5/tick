import { View } from 'react-native'
import { appStyles } from '@/constants/app-styles'
import { getAddMemoInstruction } from '@solana-program/memo'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Address, Instruction } from '@solana/kit'
import { AppButton } from '@/components/app-button'

export function AccountFeatureSignTransaction({ address }: { address: Address }) {
  const { sendTransactions } = useMobileWallet()

  async function submit() {
    console.log('submit')
    try {
      const instructions: Instruction[] = [
        // You can add more instructions here
        getAddMemoInstruction({ memo: `gm from Mobile Wallet Adapter - ${address}` }),
      ]

      const signature = await sendTransactions(instructions)

      console.log(`Signed transaction: ${signature}!`)
    } catch (e) {
      console.log(`Error signing transaction: ${e}`)
    }
  }
  return (
    <View style={appStyles.stack}>
      <AppButton onPress={submit} title="Sign transaction" />
    </View>
  )
}
