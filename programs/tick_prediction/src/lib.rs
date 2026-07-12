use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};

declare_id!("4gaZzuoNzEWUtRnLSFeHABQTn2hPxKy3V5qeVsUSYaJz");

const SYMBOL_BYTES: usize = 8;
const TILE_COUNT: usize = 9;
const TILE_COUNT_U8: u8 = 9;
const BTC_AXIS_RANGE: i64 = 1_000;
const ETH_AXIS_RANGE: i64 = 200;
const SOL_AXIS_RANGE: i64 = 20;
const STAKE_AMOUNT: u64 = 1_000_000;
const USDC_DECIMALS: u8 = 6;
const POOL_SEED: &[u8] = b"pool_v2";
const MULTIPLIER_BPS: [u32; TILE_COUNT] = [3_000, 2_000, 1_250, 1_000, 500, 300, 250, 200, 150];

#[ephemeral]
#[program]
pub mod tick_prediction {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        symbol: String,
        duration_seconds: i64,
        prediction_window_seconds: i64,
    ) -> Result<()> {
        require!(duration_seconds > 0, TickError::InvalidDuration);
        require!(
            prediction_window_seconds > 0 && prediction_window_seconds < duration_seconds,
            TickError::InvalidPredictionWindow
        );
        require!(
            ctx.accounts.usdc_mint.decimals == USDC_DECIMALS,
            TickError::InvalidMint
        );
        require!(is_supported_symbol(&symbol), TickError::UnsupportedSymbol);

        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.symbol = symbol_to_bytes(&symbol)?;
        pool.usdc_mint = ctx.accounts.usdc_mint.key();
        pool.vault = ctx.accounts.vault.key();
        pool.vault_authority = ctx.accounts.vault_authority.key();
        pool.duration_seconds = duration_seconds;
        pool.prediction_window_seconds = prediction_window_seconds;
        pool.bump = ctx.bumps.pool;
        pool.vault_bump = ctx.bumps.vault_authority;

        Ok(())
    }

    pub fn open_round(
        ctx: Context<OpenRound>,
        round_id: u64,
        start_price: i64,
        starts_at: i64,
        ends_at: i64,
    ) -> Result<()> {
        write_round(
            &ctx.accounts.pool,
            &mut ctx.accounts.round,
            round_id,
            start_price,
            starts_at,
            ends_at,
            ctx.bumps.round,
        )
    }

    pub fn authorize_pool_session(ctx: Context<AuthorizePoolSession>, expires_at: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        require!(expires_at > now, TickError::InvalidSessionExpiry);

        let pool_session = &mut ctx.accounts.pool_session;
        pool_session.pool = ctx.accounts.pool.key();
        pool_session.authority = ctx.accounts.authority.key();
        pool_session.session_authority = ctx.accounts.session_authority.key();
        pool_session.expires_at = expires_at;
        pool_session.bump = ctx.bumps.pool_session;

        Ok(())
    }

    pub fn open_round_with_session(
        ctx: Context<OpenRoundWithSession>,
        round_id: u64,
        start_price: i64,
        starts_at: i64,
        ends_at: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        require!(
            ctx.accounts.pool_session.session_authority == ctx.accounts.session_authority.key(),
            TickError::InvalidSessionAuthority
        );
        require!(
            ctx.accounts.pool_session.expires_at >= now,
            TickError::SessionExpired
        );

        write_round(
            &ctx.accounts.pool,
            &mut ctx.accounts.round,
            round_id,
            start_price,
            starts_at,
            ends_at,
            ctx.bumps.round,
        )
    }

    pub fn place_tile_prediction(ctx: Context<PlaceTilePrediction>, tile_index: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let round = &ctx.accounts.round;

        require!(tile_index < TILE_COUNT_U8, TickError::InvalidTile);
        require!(round.status == RoundStatus::Open, TickError::RoundNotOpen);
        require!(now >= round.starts_at, TickError::RoundNotStarted);
        require!(
            now < round.starts_at + ctx.accounts.pool.prediction_window_seconds,
            TickError::PredictionWindowClosed
        );
        require!(
            ctx.accounts.predictor_token_account.mint == ctx.accounts.pool.usdc_mint,
            TickError::InvalidMint
        );
        require!(
            ctx.accounts.vault.key() == ctx.accounts.pool.vault,
            TickError::InvalidVault
        );

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.predictor_token_account.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.predictor.to_account_info(),
                },
            ),
            STAKE_AMOUNT,
            USDC_DECIMALS,
        )?;

        let prediction = &mut ctx.accounts.prediction;
        prediction.round = round.key();
        prediction.predictor = ctx.accounts.predictor.key();
        prediction.session_authority = ctx.accounts.predictor.key();
        prediction.tile_index = tile_index;
        prediction.stake_amount = STAKE_AMOUNT;
        prediction.multiplier_bps = round.multipliers_bps[tile_index as usize];
        prediction.created_at = now;
        prediction.claimed = false;
        prediction.bump = ctx.bumps.prediction;

        Ok(())
    }

    pub fn fund_prediction(ctx: Context<FundPrediction>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let round = &ctx.accounts.round;

        require!(round.status == RoundStatus::Open, TickError::RoundNotOpen);
        require!(now >= round.starts_at, TickError::RoundNotStarted);
        require!(
            now < round.starts_at + ctx.accounts.pool.prediction_window_seconds,
            TickError::PredictionWindowClosed
        );
        require!(
            ctx.accounts.predictor_token_account.mint == ctx.accounts.pool.usdc_mint,
            TickError::InvalidMint
        );
        require!(
            ctx.accounts.predictor_token_account.owner == ctx.accounts.payer.key(),
            TickError::InvalidPredictorTokenAccount
        );
        require!(
            ctx.accounts.predictor.key() == ctx.accounts.payer.key()
                || ctx.accounts.session_authority.key() == ctx.accounts.payer.key(),
            TickError::InvalidPredictor
        );
        require!(
            ctx.accounts.vault.key() == ctx.accounts.pool.vault,
            TickError::InvalidVault
        );

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.predictor_token_account.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            STAKE_AMOUNT,
            USDC_DECIMALS,
        )?;

        let prediction = &mut ctx.accounts.prediction;
        prediction.round = round.key();
        prediction.predictor = ctx.accounts.predictor.key();
        prediction.session_authority = ctx.accounts.session_authority.key();
        prediction.tile_index = u8::MAX;
        prediction.stake_amount = STAKE_AMOUNT;
        prediction.multiplier_bps = 0;
        prediction.created_at = now;
        prediction.claimed = false;
        prediction.bump = ctx.bumps.prediction;

        Ok(())
    }

    pub fn select_tile_on_er(ctx: Context<SelectTileOnEr>, tile_index: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let round = &ctx.accounts.round;

        require!(tile_index < TILE_COUNT_U8, TickError::InvalidTile);
        require!(round.status == RoundStatus::Open, TickError::RoundNotOpen);
        require!(now >= round.starts_at, TickError::RoundNotStarted);
        require!(
            now < round.starts_at + ctx.accounts.pool.prediction_window_seconds,
            TickError::PredictionWindowClosed
        );
        require!(
            ctx.accounts.prediction.tile_index == u8::MAX,
            TickError::PredictionAlreadySelected
        );
        require!(
            ctx.accounts.prediction.session_authority == ctx.accounts.session_authority.key(),
            TickError::InvalidSessionAuthority
        );

        let prediction = &mut ctx.accounts.prediction;
        prediction.tile_index = tile_index;
        prediction.multiplier_bps = round.multipliers_bps[tile_index as usize];

        Ok(())
    }

    pub fn delegate_round(ctx: Context<DelegateRound>, round_id: u64) -> Result<()> {
        let pool_key = ctx.accounts.pool.key();
        let round_id_seed = round_id.to_le_bytes();

        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[b"round", pool_key.as_ref(), &round_id_seed],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|account| account.key()),
                ..Default::default()
            },
        )?;

        Ok(())
    }

    pub fn delegate_prediction(ctx: Context<DelegatePrediction>) -> Result<()> {
        let round_key = ctx.accounts.round.key();
        let predictor_key = ctx.accounts.predictor.key();

        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[b"prediction", round_key.as_ref(), predictor_key.as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|account| account.key()),
                ..Default::default()
            },
        )?;

        Ok(())
    }

    pub fn commit_round(ctx: Context<CommitRound>) -> Result<()> {
        let payer = ctx.accounts.payer.to_account_info();
        let round = ctx.accounts.round.to_account_info();
        let magic_context = ctx.accounts.magic_context.to_account_info();
        let magic_program = ctx.accounts.magic_program.to_account_info();
        commit_accounts(&payer, vec![&round], &magic_context, &magic_program)?;

        Ok(())
    }

    pub fn commit_prediction(ctx: Context<CommitPrediction>) -> Result<()> {
        let payer = ctx.accounts.payer.to_account_info();
        let prediction = ctx.accounts.prediction.to_account_info();
        let magic_context = ctx.accounts.magic_context.to_account_info();
        let magic_program = ctx.accounts.magic_program.to_account_info();
        commit_accounts(&payer, vec![&prediction], &magic_context, &magic_program)?;

        Ok(())
    }

    pub fn undelegate_round(ctx: Context<CommitRound>) -> Result<()> {
        ctx.accounts.round.exit(&crate::ID)?;
        let payer = ctx.accounts.payer.to_account_info();
        let round = ctx.accounts.round.to_account_info();
        let magic_context = ctx.accounts.magic_context.to_account_info();
        let magic_program = ctx.accounts.magic_program.to_account_info();
        commit_and_undelegate_accounts(&payer, vec![&round], &magic_context, &magic_program)?;

        Ok(())
    }

    pub fn undelegate_prediction(ctx: Context<CommitPrediction>) -> Result<()> {
        ctx.accounts.prediction.exit(&crate::ID)?;
        let payer = ctx.accounts.payer.to_account_info();
        let prediction = ctx.accounts.prediction.to_account_info();
        let magic_context = ctx.accounts.magic_context.to_account_info();
        let magic_program = ctx.accounts.magic_program.to_account_info();
        commit_and_undelegate_accounts(&payer, vec![&prediction], &magic_context, &magic_program)?;

        Ok(())
    }

    pub fn settle_round(ctx: Context<SettleRound>, final_price: i64) -> Result<()> {
        require!(
            ctx.accounts.pool.authority == ctx.accounts.authority.key(),
            TickError::Unauthorized
        );
        require!(final_price > 0, TickError::InvalidPrice);

        let now = Clock::get()?.unix_timestamp;
        let round = &mut ctx.accounts.round;

        require!(round.status == RoundStatus::Open, TickError::RoundNotOpen);
        require!(now >= round.ends_at, TickError::RoundNotEnded);

        round.final_price = final_price;
        round.winning_tile_index =
            price_to_tile_index(round.start_price, final_price, &ctx.accounts.pool.symbol)?;
        round.status = RoundStatus::Settled;

        Ok(())
    }

    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        require!(
            ctx.accounts.pool.authority == ctx.accounts.authority.key(),
            TickError::Unauthorized
        );
        require!(ctx.accounts.round.status == RoundStatus::Settled, TickError::RoundNotSettled);
        require!(!ctx.accounts.prediction.claimed, TickError::AlreadyClaimed);
        require!(
            ctx.accounts.prediction.tile_index == ctx.accounts.round.winning_tile_index,
            TickError::PredictionLost
        );
        require!(
            ctx.accounts.claimant_token_account.mint == ctx.accounts.pool.usdc_mint,
            TickError::InvalidMint
        );
        require!(
            ctx.accounts.claimant_token_account.owner == ctx.accounts.prediction.predictor,
            TickError::InvalidClaimantTokenAccount
        );
        require!(
            ctx.accounts.vault.key() == ctx.accounts.pool.vault,
            TickError::InvalidVault
        );

        let payout = ctx
            .accounts
            .prediction
            .stake_amount
            .checked_mul(ctx.accounts.prediction.multiplier_bps as u64)
            .ok_or(TickError::MathOverflow)?
            .checked_div(10_000)
            .and_then(|profit_amount| {
                profit_amount.checked_add(ctx.accounts.prediction.stake_amount)
            })
            .ok_or(TickError::MathOverflow)?;
        require!(
            ctx.accounts.vault.amount >= payout,
            TickError::InsufficientVaultFunds
        );

        let pool_key = ctx.accounts.pool.key();
        let signer_seeds: &[&[u8]] = &[
            b"vault_authority",
            pool_key.as_ref(),
            &[ctx.accounts.pool.vault_bump],
        ];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.claimant_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[signer_seeds],
            ),
            payout,
            USDC_DECIMALS,
        )?;

        ctx.accounts.prediction.claimed = true;

        Ok(())
    }

}

#[derive(Accounts)]
#[instruction(symbol: String)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = authority,
        space = Pool::SPACE,
        seeds = [POOL_SEED, symbol.as_bytes()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    /// CHECK: PDA authority for the pool token vault.
    #[account(
        seeds = [b"vault_authority", pool.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = vault_authority,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct OpenRound<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = authority,
        space = Round::SPACE,
        seeds = [b"round", pool.key().as_ref(), &round_id.to_le_bytes()],
        bump
    )]
    pub round: Account<'info, Round>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorizePoolSession<'info> {
    #[account(has_one = authority)]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = authority,
        space = PoolSession::SPACE,
        seeds = [
            b"pool_session",
            pool.key().as_ref(),
            authority.key().as_ref(),
            session_authority.key().as_ref()
        ],
        bump
    )]
    pub pool_session: Account<'info, PoolSession>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Short-lived signer authorized by the pool authority.
    pub session_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct OpenRoundWithSession<'info> {
    #[account(has_one = authority)]
    pub pool: Account<'info, Pool>,
    #[account(
        seeds = [
            b"pool_session",
            pool.key().as_ref(),
            authority.key().as_ref(),
            session_authority.key().as_ref()
        ],
        bump = pool_session.bump
    )]
    pub pool_session: Account<'info, PoolSession>,
    /// CHECK: Pool authority used as a PDA seed.
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub session_authority: Signer<'info>,
    #[account(
        init,
        payer = session_authority,
        space = Round::SPACE,
        seeds = [b"round", pool.key().as_ref(), &round_id.to_le_bytes()],
        bump
    )]
    pub round: Account<'info, Round>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceTilePrediction<'info> {
    pub pool: Account<'info, Pool>,
    #[account(
        seeds = [b"round", round.pool.as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump,
        has_one = pool
    )]
    pub round: Account<'info, Round>,
    #[account(
        init,
        payer = predictor,
        space = TilePrediction::SPACE,
        seeds = [b"prediction", round.key().as_ref(), predictor.key().as_ref()],
        bump
    )]
    pub prediction: Account<'info, TilePrediction>,
    #[account(mut)]
    pub predictor: Signer<'info>,
    #[account(mut)]
    pub predictor_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundPrediction<'info> {
    pub pool: Account<'info, Pool>,
    #[account(
        seeds = [b"round", round.pool.as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump,
        has_one = pool
    )]
    pub round: Account<'info, Round>,
    #[account(
        init,
        payer = payer,
        space = TilePrediction::SPACE,
        seeds = [b"prediction", round.key().as_ref(), predictor.key().as_ref()],
        bump
    )]
    pub prediction: Account<'info, TilePrediction>,
    /// CHECK: Prediction owner and payout recipient. The payer funds the stake.
    pub predictor: UncheckedAccount<'info>,
    /// CHECK: Short-lived signer allowed to select the tile on the Ephemeral Rollup.
    pub session_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub predictor_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SelectTileOnEr<'info> {
    pub pool: Account<'info, Pool>,
    #[account(
        seeds = [b"round", round.pool.as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump,
        has_one = pool
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [b"prediction", round.key().as_ref(), predictor.key().as_ref()],
        bump = prediction.bump,
        has_one = round
    )]
    pub prediction: Account<'info, TilePrediction>,
    /// CHECK: Prediction owner used as a PDA seed.
    pub predictor: UncheckedAccount<'info>,
    pub session_authority: Signer<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct DelegateRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub pool: Account<'info, Pool>,
    /// CHECK: The round PDA is delegated by MagicBlock's delegation program.
    #[account(
        mut,
        del,
        seeds = [b"round", pool.key().as_ref(), &round_id.to_le_bytes()],
        bump
    )]
    pub pda: AccountInfo<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePrediction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"round", round.pool.as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    /// CHECK: Used as a PDA seed; payer normally matches predictor in the client flow.
    pub predictor: UncheckedAccount<'info>,
    /// CHECK: The prediction PDA is delegated by MagicBlock's delegation program.
    #[account(
        mut,
        del,
        seeds = [b"prediction", round.key().as_ref(), predictor.key().as_ref()],
        bump
    )]
    pub pda: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"round", round.pool.as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    /// CHECK: Your program ID, required by MagicBlock commit account routing.
    pub program_id: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitPrediction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"round", round.pool.as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [b"prediction", round.key().as_ref(), prediction.predictor.as_ref()],
        bump = prediction.bump,
        has_one = round
    )]
    pub prediction: Account<'info, TilePrediction>,
    /// CHECK: Your program ID, required by MagicBlock commit account routing.
    pub program_id: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct SettleRound<'info> {
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [b"round", round.pool.as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump,
        has_one = pool
    )]
    pub round: Account<'info, Round>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    #[account(has_one = authority)]
    pub pool: Account<'info, Pool>,
    #[account(
        seeds = [b"round", round.pool.as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump,
        has_one = pool
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [b"prediction", round.key().as_ref(), prediction.predictor.as_ref()],
        bump = prediction.bump,
        has_one = round
    )]
    pub prediction: Account<'info, TilePrediction>,
    /// CHECK: PDA authority for the pool token vault.
    #[account(
        seeds = [b"vault_authority", pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub claimant_token_account: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Pool {
    pub authority: Pubkey,
    pub symbol: [u8; SYMBOL_BYTES],
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub vault_authority: Pubkey,
    pub duration_seconds: i64,
    pub prediction_window_seconds: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Pool {
    pub const SPACE: usize = 8 + 32 + SYMBOL_BYTES + 32 + 32 + 32 + 8 + 8 + 1 + 1;
}

#[account]
pub struct PoolSession {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub session_authority: Pubkey,
    pub expires_at: i64,
    pub bump: u8,
}

impl PoolSession {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 1;
}

#[account]
pub struct Round {
    pub pool: Pubkey,
    pub round_id: u64,
    pub start_price: i64,
    pub final_price: i64,
    pub starts_at: i64,
    pub ends_at: i64,
    pub status: RoundStatus,
    pub winning_tile_index: u8,
    pub tile_width_bps: i64,
    pub multipliers_bps: [u32; TILE_COUNT],
    pub bump: u8,
}

impl Round {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 8 + 4 * TILE_COUNT + 1;
}

#[account]
pub struct TilePrediction {
    pub round: Pubkey,
    pub predictor: Pubkey,
    pub session_authority: Pubkey,
    pub tile_index: u8,
    pub stake_amount: u64,
    pub multiplier_bps: u32,
    pub created_at: i64,
    pub claimed: bool,
    pub bump: u8,
}

impl TilePrediction {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1 + 8 + 4 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RoundStatus {
    Open,
    Settled,
}

#[error_code]
pub enum TickError {
    #[msg("Pool symbol must be BTC, SOL, or ETH")]
    UnsupportedSymbol,
    #[msg("Duration must be greater than zero")]
    InvalidDuration,
    #[msg("Prediction window must be greater than zero and less than duration")]
    InvalidPredictionWindow,
    #[msg("Round start/final price must be greater than zero")]
    InvalidPrice,
    #[msg("Round window must match the pool duration")]
    InvalidRoundWindow,
    #[msg("Round has not started")]
    RoundNotStarted,
    #[msg("Round is already closed")]
    RoundClosed,
    #[msg("Round is not open")]
    RoundNotOpen,
    #[msg("Round has not ended")]
    RoundNotEnded,
    #[msg("Round is not settled")]
    RoundNotSettled,
    #[msg("Tile index is invalid")]
    InvalidTile,
    #[msg("Prediction window is closed")]
    PredictionWindowClosed,
    #[msg("Only the pool authority can perform this action")]
    Unauthorized,
    #[msg("USDC mint is invalid")]
    InvalidMint,
    #[msg("Predictor must match the funding payer")]
    InvalidPredictor,
    #[msg("Predictor token account must belong to the funding payer")]
    InvalidPredictorTokenAccount,
    #[msg("Pool vault is invalid")]
    InvalidVault,
    #[msg("Claimant token account must belong to the prediction owner")]
    InvalidClaimantTokenAccount,
    #[msg("Prediction did not hit the winning tile")]
    PredictionLost,
    #[msg("Payout has already been claimed")]
    AlreadyClaimed,
    #[msg("Prediction already selected a tile")]
    PredictionAlreadySelected,
    #[msg("Session authority is invalid")]
    InvalidSessionAuthority,
    #[msg("Session expiry is invalid")]
    InvalidSessionExpiry,
    #[msg("Session has expired")]
    SessionExpired,
    #[msg("Vault does not have enough funds")]
    InsufficientVaultFunds,
    #[msg("Math overflow")]
    MathOverflow,
}

fn is_supported_symbol(symbol: &str) -> bool {
    matches!(symbol, "BTC" | "SOL" | "ETH")
}

fn symbol_to_bytes(symbol: &str) -> Result<[u8; SYMBOL_BYTES]> {
    require!(symbol.len() <= SYMBOL_BYTES, TickError::UnsupportedSymbol);

    let mut bytes = [0_u8; SYMBOL_BYTES];
    bytes[..symbol.len()].copy_from_slice(symbol.as_bytes());
    Ok(bytes)
}

fn write_round(
    pool: &Account<Pool>,
    round: &mut Account<Round>,
    round_id: u64,
    start_price: i64,
    starts_at: i64,
    ends_at: i64,
    bump: u8,
) -> Result<()> {
    require!(start_price > 0, TickError::InvalidPrice);
    require!(ends_at > starts_at, TickError::InvalidRoundWindow);
    require!(
        ends_at
            .checked_sub(starts_at)
            .ok_or(TickError::InvalidRoundWindow)?
            == pool.duration_seconds,
        TickError::InvalidRoundWindow
    );

    round.pool = pool.key();
    round.round_id = round_id;
    round.start_price = start_price;
    round.final_price = 0;
    round.starts_at = starts_at;
    round.ends_at = ends_at;
    round.status = RoundStatus::Open;
    round.winning_tile_index = u8::MAX;
    round.tile_width_bps = price_axis_range(&pool.symbol)?
        .checked_div(TILE_COUNT as i64)
        .ok_or(TickError::MathOverflow)?;
    round.multipliers_bps = MULTIPLIER_BPS;
    round.bump = bump;

    Ok(())
}

fn price_axis_range(symbol: &[u8; SYMBOL_BYTES]) -> Result<i64> {
    if symbol.starts_with(b"BTC") {
        return Ok(BTC_AXIS_RANGE);
    }

    if symbol.starts_with(b"ETH") {
        return Ok(ETH_AXIS_RANGE);
    }

    if symbol.starts_with(b"SOL") {
        return Ok(SOL_AXIS_RANGE);
    }

    err!(TickError::UnsupportedSymbol)
}

fn price_to_tile_index(
    start_price: i64,
    final_price: i64,
    symbol: &[u8; SYMBOL_BYTES],
) -> Result<u8> {
    require!(start_price > 0 && final_price > 0, TickError::InvalidPrice);
    let axis_range = price_axis_range(symbol)?;
    let min_price = start_price
        .checked_sub(axis_range.checked_div(2).ok_or(TickError::MathOverflow)?)
        .ok_or(TickError::MathOverflow)?;
    let offset = final_price
        .checked_sub(min_price)
        .ok_or(TickError::MathOverflow)?;
    let raw_index = offset
        .checked_mul(TILE_COUNT as i64)
        .ok_or(TickError::MathOverflow)?
        .checked_div(axis_range)
        .ok_or(TickError::MathOverflow)?;

    Ok(raw_index.clamp(0, (TILE_COUNT - 1) as i64) as u8)
}
