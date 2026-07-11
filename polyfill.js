import { install } from 'react-native-quick-crypto'
import { Buffer } from 'buffer'

install()

global.Buffer = global.Buffer || Buffer
