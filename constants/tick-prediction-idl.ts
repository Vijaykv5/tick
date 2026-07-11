export const TICK_PREDICTION_IDL = {
  address: '4gaZzuoNzEWUtRnLSFeHABQTn2hPxKy3V5qeVsUSYaJz',
  metadata: {
    name: 'tick_prediction',
    version: '0.1.0',
    spec: '0.1.0',
    description: 'State-only prediction pools for Tick',
  },
  instructions: [
    {
      name: 'initialize_pool',
      discriminator: [95, 180, 10, 172, 84, 174, 232, 40],
      accounts: [
        { name: 'pool', writable: true },
        { name: 'authority', writable: true, signer: true },
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [
        { name: 'symbol', type: 'string' },
        { name: 'duration_seconds', type: 'i64' },
      ],
    },
    {
      name: 'open_round',
      discriminator: [66, 235, 123, 240, 8, 35, 185, 159],
      accounts: [
        { name: 'pool', writable: true },
        { name: 'round', writable: true },
        { name: 'authority', writable: true, signer: true },
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [
        { name: 'round_id', type: 'u64' },
        { name: 'start_price', type: 'i64' },
        { name: 'starts_at', type: 'i64' },
        { name: 'ends_at', type: 'i64' },
      ],
    },
    {
      name: 'place_prediction',
      discriminator: [79, 46, 195, 197, 50, 91, 88, 229],
      accounts: [
        { name: 'round' },
        { name: 'prediction', writable: true },
        { name: 'predictor', writable: true, signer: true },
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [{ name: 'direction', type: { defined: { name: 'Direction' } } }],
    },
  ],
  accounts: [
    { name: 'Pool', discriminator: [241, 154, 109, 4, 17, 177, 109, 188] },
    { name: 'Prediction', discriminator: [98, 127, 141, 187, 218, 33, 8, 14] },
    { name: 'Round', discriminator: [87, 127, 165, 51, 73, 78, 116, 174] },
  ],
  errors: [
    { code: 6000, name: 'UnsupportedSymbol', msg: 'Pool symbol must be BTC, SOL, or ETH' },
    { code: 6001, name: 'InvalidDuration', msg: 'Duration must be greater than zero' },
    { code: 6002, name: 'InvalidPrice', msg: 'Round start price must be greater than zero' },
    { code: 6003, name: 'InvalidRoundWindow', msg: 'Round window must match the pool duration' },
    { code: 6004, name: 'RoundNotStarted', msg: 'Round has not started' },
    { code: 6005, name: 'RoundClosed', msg: 'Round is already closed' },
    { code: 6006, name: 'RoundNotOpen', msg: 'Round is not open' },
  ],
  types: [
    {
      name: 'Direction',
      type: { kind: 'enum', variants: [{ name: 'Up' }, { name: 'Down' }] },
    },
    {
      name: 'Pool',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'pubkey' },
          { name: 'symbol', type: { array: ['u8', 8] } },
          { name: 'duration_seconds', type: 'i64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'Prediction',
      type: {
        kind: 'struct',
        fields: [
          { name: 'round', type: 'pubkey' },
          { name: 'predictor', type: 'pubkey' },
          { name: 'direction', type: { defined: { name: 'Direction' } } },
          { name: 'created_at', type: 'i64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'Round',
      type: {
        kind: 'struct',
        fields: [
          { name: 'pool', type: 'pubkey' },
          { name: 'round_id', type: 'u64' },
          { name: 'start_price', type: 'i64' },
          { name: 'starts_at', type: 'i64' },
          { name: 'ends_at', type: 'i64' },
          { name: 'status', type: { defined: { name: 'RoundStatus' } } },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'RoundStatus',
      type: { kind: 'enum', variants: [{ name: 'Open' }] },
    },
  ],
} as const
