export const TICK_PREDICTION_IDL = {
  "address": "4gaZzuoNzEWUtRnLSFeHABQTn2hPxKy3V5qeVsUSYaJz",
  "metadata": {
    "name": "tick_prediction",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "State-only prediction pools for Tick"
  },
  "instructions": [
    {
      "name": "claim_payout",
      "discriminator": [
        127,
        240,
        132,
        62,
        227,
        198,
        146,
        133
      ],
      "accounts": [
        {
          "name": "pool",
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "round.pool",
                "account": "Round"
              },
              {
                "kind": "account",
                "path": "round.round_id",
                "account": "Round"
              }
            ]
          },
          "relations": [
            "prediction"
          ]
        },
        {
          "name": "prediction",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  100,
                  105,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "round"
              },
              {
                "kind": "account",
                "path": "claimant"
              }
            ]
          }
        },
        {
          "name": "vault_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "claimant",
          "writable": true,
          "signer": true
        },
        {
          "name": "claimant_token_account",
          "writable": true
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "initialize_pool",
      "discriminator": [
        95,
        180,
        10,
        172,
        84,
        174,
        232,
        40
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "arg",
                "path": "symbol"
              }
            ]
          }
        },
        {
          "name": "vault_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "duration_seconds",
          "type": "i64"
        },
        {
          "name": "prediction_window_seconds",
          "type": "i64"
        }
      ]
    },
    {
      "name": "open_round",
      "discriminator": [
        66,
        235,
        123,
        240,
        8,
        35,
        185,
        159
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "round",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "arg",
                "path": "round_id"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "round_id",
          "type": "u64"
        },
        {
          "name": "start_price",
          "type": "i64"
        },
        {
          "name": "starts_at",
          "type": "i64"
        },
        {
          "name": "ends_at",
          "type": "i64"
        }
      ]
    },
    {
      "name": "place_tile_prediction",
      "discriminator": [
        192,
        205,
        213,
        104,
        153,
        160,
        70,
        46
      ],
      "accounts": [
        {
          "name": "pool",
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "round.pool",
                "account": "Round"
              },
              {
                "kind": "account",
                "path": "round.round_id",
                "account": "Round"
              }
            ]
          }
        },
        {
          "name": "prediction",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  101,
                  100,
                  105,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "round"
              },
              {
                "kind": "account",
                "path": "predictor"
              }
            ]
          }
        },
        {
          "name": "predictor",
          "writable": true,
          "signer": true
        },
        {
          "name": "predictor_token_account",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "usdc_mint"
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tile_index",
          "type": "u8"
        }
      ]
    },
    {
      "name": "settle_round",
      "discriminator": [
        40,
        101,
        18,
        1,
        31,
        129,
        52,
        77
      ],
      "accounts": [
        {
          "name": "pool",
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "round.pool",
                "account": "Round"
              },
              {
                "kind": "account",
                "path": "round.round_id",
                "account": "Round"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "final_price",
          "type": "i64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "Pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      "name": "Round",
      "discriminator": [
        87,
        127,
        165,
        51,
        73,
        78,
        116,
        174
      ]
    },
    {
      "name": "TilePrediction",
      "discriminator": [
        95,
        162,
        193,
        71,
        143,
        168,
        72,
        74
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "UnsupportedSymbol",
      "msg": "Pool symbol must be BTC, SOL, or ETH"
    },
    {
      "code": 6001,
      "name": "InvalidDuration",
      "msg": "Duration must be greater than zero"
    },
    {
      "code": 6002,
      "name": "InvalidPredictionWindow",
      "msg": "Prediction window must be greater than zero and less than duration"
    },
    {
      "code": 6003,
      "name": "InvalidPrice",
      "msg": "Round start/final price must be greater than zero"
    },
    {
      "code": 6004,
      "name": "InvalidRoundWindow",
      "msg": "Round window must match the pool duration"
    },
    {
      "code": 6005,
      "name": "RoundNotStarted",
      "msg": "Round has not started"
    },
    {
      "code": 6006,
      "name": "RoundClosed",
      "msg": "Round is already closed"
    },
    {
      "code": 6007,
      "name": "RoundNotOpen",
      "msg": "Round is not open"
    },
    {
      "code": 6008,
      "name": "RoundNotEnded",
      "msg": "Round has not ended"
    },
    {
      "code": 6009,
      "name": "RoundNotSettled",
      "msg": "Round is not settled"
    },
    {
      "code": 6010,
      "name": "InvalidTile",
      "msg": "Tile index is invalid"
    },
    {
      "code": 6011,
      "name": "PredictionWindowClosed",
      "msg": "Prediction window is closed"
    },
    {
      "code": 6012,
      "name": "Unauthorized",
      "msg": "Only the pool authority can perform this action"
    },
    {
      "code": 6013,
      "name": "InvalidMint",
      "msg": "USDC mint is invalid"
    },
    {
      "code": 6014,
      "name": "InvalidVault",
      "msg": "Pool vault is invalid"
    },
    {
      "code": 6015,
      "name": "PredictionLost",
      "msg": "Prediction did not hit the winning tile"
    },
    {
      "code": 6016,
      "name": "AlreadyClaimed",
      "msg": "Payout has already been claimed"
    },
    {
      "code": 6017,
      "name": "InsufficientVaultFunds",
      "msg": "Vault does not have enough funds"
    },
    {
      "code": 6018,
      "name": "MathOverflow",
      "msg": "Math overflow"
    }
  ],
  "types": [
    {
      "name": "Pool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "symbol",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "usdc_mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "vault_authority",
            "type": "pubkey"
          },
          {
            "name": "duration_seconds",
            "type": "i64"
          },
          {
            "name": "prediction_window_seconds",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vault_bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "Round",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round_id",
            "type": "u64"
          },
          {
            "name": "start_price",
            "type": "i64"
          },
          {
            "name": "final_price",
            "type": "i64"
          },
          {
            "name": "starts_at",
            "type": "i64"
          },
          {
            "name": "ends_at",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "RoundStatus"
              }
            }
          },
          {
            "name": "winning_tile_index",
            "type": "u8"
          },
          {
            "name": "tile_width_bps",
            "type": "i64"
          },
          {
            "name": "multipliers_bps",
            "type": {
              "array": [
                "u32",
                9
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "RoundStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Open"
          },
          {
            "name": "Settled"
          }
        ]
      }
    },
    {
      "name": "TilePrediction",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "predictor",
            "type": "pubkey"
          },
          {
            "name": "tile_index",
            "type": "u8"
          },
          {
            "name": "stake_amount",
            "type": "u64"
          },
          {
            "name": "multiplier_bps",
            "type": "u32"
          },
          {
            "name": "created_at",
            "type": "i64"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
} as const
