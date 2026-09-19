// Official pump-public-docs f216b6724c6ede79d7cef9ce210b741f7e17e93b; IDL 0.1.0.
// Deliberate static subset; see docs/pump-authority-provenance.json.
export const PUMP_TYPES = {
  "BondingCurve": [
    {
      "name": "virtual_token_reserves",
      "type": "u64"
    },
    {
      "name": "virtual_quote_reserves",
      "type": "u64"
    },
    {
      "name": "real_token_reserves",
      "type": "u64"
    },
    {
      "name": "real_quote_reserves",
      "type": "u64"
    },
    {
      "name": "token_total_supply",
      "type": "u64"
    },
    {
      "name": "complete",
      "type": "bool"
    },
    {
      "name": "creator",
      "type": "pubkey"
    },
    {
      "name": "is_mayhem_mode",
      "type": "bool"
    },
    {
      "name": "is_cashback_coin",
      "type": "bool"
    },
    {
      "name": "quote_mint",
      "type": "pubkey"
    },
    {
      "name": "creator_fee_bps",
      "type": "u64"
    },
    {
      "name": "can_edit_creator_fee",
      "type": "bool"
    },
    {
      "name": "is_holder_reward",
      "type": "bool"
    }
  ],
  "Global": [
    {
      "name": "initialized",
      "type": "bool"
    },
    {
      "name": "authority",
      "type": "pubkey"
    },
    {
      "name": "fee_recipient",
      "type": "pubkey"
    },
    {
      "name": "initial_virtual_token_reserves",
      "type": "u64"
    },
    {
      "name": "initial_virtual_sol_reserves",
      "type": "u64"
    },
    {
      "name": "initial_real_token_reserves",
      "type": "u64"
    },
    {
      "name": "token_total_supply",
      "type": "u64"
    },
    {
      "name": "fee_basis_points",
      "type": "u64"
    },
    {
      "name": "withdraw_authority",
      "type": "pubkey"
    },
    {
      "name": "enable_migrate",
      "type": "bool"
    },
    {
      "name": "pool_migration_fee",
      "type": "u64"
    },
    {
      "name": "creator_fee_basis_points",
      "type": "u64"
    },
    {
      "name": "fee_recipients",
      "type": {
        "array": [
          "pubkey",
          7
        ]
      }
    },
    {
      "name": "set_creator_authority",
      "type": "pubkey"
    },
    {
      "name": "admin_set_creator_authority",
      "type": "pubkey"
    },
    {
      "name": "create_v2_enabled",
      "type": "bool"
    },
    {
      "name": "whitelist_pda",
      "type": "pubkey"
    },
    {
      "name": "reserved_fee_recipient",
      "type": "pubkey"
    },
    {
      "name": "mayhem_mode_enabled",
      "type": "bool"
    },
    {
      "name": "reserved_fee_recipients",
      "type": {
        "array": [
          "pubkey",
          7
        ]
      }
    },
    {
      "name": "is_cashback_enabled",
      "type": "bool"
    },
    {
      "name": "buyback_fee_recipients",
      "type": {
        "array": [
          "pubkey",
          8
        ]
      }
    },
    {
      "name": "buyback_basis_points",
      "type": "u64"
    },
    {
      "name": "initial_virtual_quote_reserves",
      "type": "u64"
    },
    {
      "name": "whitelisted_quote_mints",
      "type": {
        "array": [
          "pubkey",
          1
        ]
      }
    },
    {
      "name": "creator_fee_configurable",
      "type": "bool"
    },
    {
      "name": "max_configurable_creator_fee_bps",
      "type": "u64"
    },
    {
      "name": "holder_reward_claim_authority",
      "type": "pubkey"
    },
    {
      "name": "is_holder_reward_enabled",
      "type": "bool"
    }
  ],
  "QuoteControl": [
    {
      "name": "admin",
      "type": "pubkey"
    },
    {
      "name": "_reserved",
      "type": {
        "array": [
          "u8",
          64
        ]
      }
    },
    {
      "name": "mints",
      "type": {
        "vec": {
          "defined": {
            "name": "QuoteControlMint"
          }
        }
      }
    }
  ],
  "QuoteControlMint": [
    {
      "name": "mint",
      "type": "pubkey"
    },
    {
      "name": "initial_virtual_quote_reserves",
      "type": "u64"
    }
  ],
  "Shareholder": [
    {
      "name": "address",
      "type": "pubkey"
    },
    {
      "name": "share_bps",
      "type": "u16"
    }
  ],
  "TradeEvent": [
    {
      "name": "mint",
      "type": "pubkey"
    },
    {
      "name": "sol_amount",
      "type": "u64"
    },
    {
      "name": "token_amount",
      "type": "u64"
    },
    {
      "name": "is_buy",
      "type": "bool"
    },
    {
      "name": "user",
      "type": "pubkey"
    },
    {
      "name": "timestamp",
      "type": "i64"
    },
    {
      "name": "virtual_sol_reserves",
      "type": "u64"
    },
    {
      "name": "virtual_token_reserves",
      "type": "u64"
    },
    {
      "name": "real_sol_reserves",
      "type": "u64"
    },
    {
      "name": "real_token_reserves",
      "type": "u64"
    },
    {
      "name": "fee_recipient",
      "type": "pubkey"
    },
    {
      "name": "fee_basis_points",
      "type": "u64"
    },
    {
      "name": "fee",
      "type": "u64"
    },
    {
      "name": "creator",
      "type": "pubkey"
    },
    {
      "name": "creator_fee_basis_points",
      "type": "u64"
    },
    {
      "name": "creator_fee",
      "type": "u64"
    },
    {
      "name": "track_volume",
      "type": "bool"
    },
    {
      "name": "total_unclaimed_tokens",
      "type": "u64"
    },
    {
      "name": "total_claimed_tokens",
      "type": "u64"
    },
    {
      "name": "current_sol_volume",
      "type": "u64"
    },
    {
      "name": "last_update_timestamp",
      "type": "i64"
    },
    {
      "name": "ix_name",
      "type": "string"
    },
    {
      "name": "mayhem_mode",
      "type": "bool"
    },
    {
      "name": "cashback_fee_basis_points",
      "type": "u64"
    },
    {
      "name": "cashback",
      "type": "u64"
    },
    {
      "name": "buyback_fee_basis_points",
      "type": "u64"
    },
    {
      "name": "buyback_fee",
      "type": "u64"
    },
    {
      "name": "shareholders",
      "type": {
        "vec": {
          "defined": {
            "name": "Shareholder"
          }
        }
      }
    },
    {
      "name": "quote_mint",
      "type": "pubkey"
    },
    {
      "name": "quote_amount",
      "type": "u64"
    },
    {
      "name": "virtual_quote_reserves",
      "type": "u64"
    },
    {
      "name": "real_quote_reserves",
      "type": "u64"
    },
    {
      "name": "holder_rewards_bps",
      "type": "u64"
    },
    {
      "name": "holder_rewards",
      "type": "u64"
    }
  ]
};
export const PUMP_TRADES = [
  {
    "name": "buy",
    "discriminator": [
      102,
      6,
      61,
      18,
      1,
      218,
      235,
      234
    ],
    "accounts": [
      "global",
      "fee_recipient",
      "mint",
      "bonding_curve",
      "associated_bonding_curve",
      "associated_user",
      "user",
      "system_program",
      "token_program",
      "creator_vault",
      "event_authority",
      "program",
      "global_volume_accumulator",
      "user_volume_accumulator",
      "fee_config",
      "fee_program"
    ]
  },
  {
    "name": "buy_exact_quote_in_v2",
    "discriminator": [
      194,
      171,
      28,
      70,
      104,
      77,
      91,
      47
    ],
    "accounts": [
      "global",
      "base_mint",
      "quote_mint",
      "base_token_program",
      "quote_token_program",
      "associated_token_program",
      "fee_recipient",
      "associated_quote_fee_recipient",
      "buyback_fee_recipient",
      "associated_quote_buyback_fee_recipient",
      "bonding_curve",
      "associated_base_bonding_curve",
      "associated_quote_bonding_curve",
      "user",
      "associated_base_user",
      "associated_quote_user",
      "creator_vault",
      "associated_creator_vault",
      "sharing_config",
      "global_volume_accumulator",
      "user_volume_accumulator",
      "associated_user_volume_accumulator",
      "fee_config",
      "fee_program",
      "system_program",
      "event_authority",
      "program"
    ]
  },
  {
    "name": "buy_exact_sol_in",
    "discriminator": [
      56,
      252,
      116,
      8,
      158,
      223,
      205,
      95
    ],
    "accounts": [
      "global",
      "fee_recipient",
      "mint",
      "bonding_curve",
      "associated_bonding_curve",
      "associated_user",
      "user",
      "system_program",
      "token_program",
      "creator_vault",
      "event_authority",
      "program",
      "global_volume_accumulator",
      "user_volume_accumulator",
      "fee_config",
      "fee_program"
    ]
  },
  {
    "name": "buy_v2",
    "discriminator": [
      184,
      23,
      238,
      97,
      103,
      197,
      211,
      61
    ],
    "accounts": [
      "global",
      "base_mint",
      "quote_mint",
      "base_token_program",
      "quote_token_program",
      "associated_token_program",
      "fee_recipient",
      "associated_quote_fee_recipient",
      "buyback_fee_recipient",
      "associated_quote_buyback_fee_recipient",
      "bonding_curve",
      "associated_base_bonding_curve",
      "associated_quote_bonding_curve",
      "user",
      "associated_base_user",
      "associated_quote_user",
      "creator_vault",
      "associated_creator_vault",
      "sharing_config",
      "global_volume_accumulator",
      "user_volume_accumulator",
      "associated_user_volume_accumulator",
      "fee_config",
      "fee_program",
      "system_program",
      "event_authority",
      "program"
    ]
  },
  {
    "name": "sell",
    "discriminator": [
      51,
      230,
      133,
      164,
      1,
      127,
      131,
      173
    ],
    "accounts": [
      "global",
      "fee_recipient",
      "mint",
      "bonding_curve",
      "associated_bonding_curve",
      "associated_user",
      "user",
      "system_program",
      "creator_vault",
      "token_program",
      "event_authority",
      "program",
      "fee_config",
      "fee_program"
    ]
  },
  {
    "name": "sell_v2",
    "discriminator": [
      93,
      246,
      130,
      60,
      231,
      233,
      64,
      178
    ],
    "accounts": [
      "global",
      "base_mint",
      "quote_mint",
      "base_token_program",
      "quote_token_program",
      "associated_token_program",
      "fee_recipient",
      "associated_quote_fee_recipient",
      "buyback_fee_recipient",
      "associated_quote_buyback_fee_recipient",
      "bonding_curve",
      "associated_base_bonding_curve",
      "associated_quote_bonding_curve",
      "user",
      "associated_base_user",
      "associated_quote_user",
      "creator_vault",
      "associated_creator_vault",
      "sharing_config",
      "user_volume_accumulator",
      "associated_user_volume_accumulator",
      "fee_config",
      "fee_program",
      "system_program",
      "event_authority",
      "program"
    ]
  }
];
