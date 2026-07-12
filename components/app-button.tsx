import { Pressable, Text } from 'react-native'
import { appStyles } from '@/constants/app-styles'

export function AppButton({ disabled, onPress, title }: { disabled?: boolean; onPress: () => void; title: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        appStyles.button,
        disabled && appStyles.buttonDisabled,
        pressed && !disabled && appStyles.buttonPressed,
      ]}
    >
      <Text style={[appStyles.buttonText, disabled && appStyles.buttonTextDisabled]}>{title}</Text>
    </Pressable>
  )
}
