use anchor_lang::prelude::*;

declare_id!("4gaZzuoNzEWUtRnLSFeHABQTn2hPxKy3V5qeVsUSYaJz");

const SYMBOL_BYTES: usize = 8;

#[program]
pub mod tick_prediction {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        symbol: String,
        duration_seconds: i64,
    ) -> Result<()> {
        require!(duration_seconds > 0, TickError::InvalidDuration);
        require!(is_supported_symbol(&symbol), TickError::UnsupportedSymbol);

        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.symbol = symbol_to_bytes(&symbol)?;
        pool.duration_seconds = duration_seconds;
        pool.bump = ctx.bumps.pool;

        Ok(())
    }

    pub fn open_round(
        ctx: Context<OpenRound>,
        round_id: u64,
        start_price: i64,
        starts_at: i64,
        ends_at: i64,
    ) -> Result<()> {
        require!(start_price > 0, TickError::InvalidPrice);
        require!(ends_at > starts_at, TickError::InvalidRoundWindow);
        require!(
            ends_at
                .checked_sub(starts_at)
                .ok_or(TickError::InvalidRoundWindow)?
                == ctx.accounts.pool.duration_seconds,
            TickError::InvalidRoundWindow
        );

        let round = &mut ctx.accounts.round;
        round.pool = ctx.accounts.pool.key();
        round.round_id = round_id;
        round.start_price = start_price;
        round.starts_at = starts_at;
        round.ends_at = ends_at;
        round.status = RoundStatus::Open;
        round.bump = ctx.bumps.round;

        Ok(())
    }

    pub fn place_prediction(ctx: Context<PlacePrediction>, direction: Direction) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let round = &ctx.accounts.round;

        require!(round.status == RoundStatus::Open, TickError::RoundNotOpen);
        require!(now >= round.starts_at, TickError::RoundNotStarted);
        require!(now < round.ends_at, TickError::RoundClosed);

        let prediction = &mut ctx.accounts.prediction;
        prediction.round = round.key();
        prediction.predictor = ctx.accounts.predictor.key();
        prediction.direction = direction;
        prediction.created_at = now;
        prediction.bump = ctx.bumps.prediction;

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
        seeds = [b"pool", symbol.as_bytes()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub authority: Signer<'info>,
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
pub struct PlacePrediction<'info> {
    #[account(
        seeds = [b"round", round.pool.as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        init,
        payer = predictor,
        space = Prediction::SPACE,
        seeds = [b"prediction", round.key().as_ref(), predictor.key().as_ref()],
        bump
    )]
    pub prediction: Account<'info, Prediction>,
    #[account(mut)]
    pub predictor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Pool {
    pub authority: Pubkey,
    pub symbol: [u8; SYMBOL_BYTES],
    pub duration_seconds: i64,
    pub bump: u8,
}

impl Pool {
    pub const SPACE: usize = 8 + 32 + SYMBOL_BYTES + 8 + 1;
}

#[account]
pub struct Round {
    pub pool: Pubkey,
    pub round_id: u64,
    pub start_price: i64,
    pub starts_at: i64,
    pub ends_at: i64,
    pub status: RoundStatus,
    pub bump: u8,
}

impl Round {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[account]
pub struct Prediction {
    pub round: Pubkey,
    pub predictor: Pubkey,
    pub direction: Direction,
    pub created_at: i64,
    pub bump: u8,
}

impl Prediction {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RoundStatus {
    Open,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Up,
    Down,
}

#[error_code]
pub enum TickError {
    #[msg("Pool symbol must be BTC, SOL, or ETH")]
    UnsupportedSymbol,
    #[msg("Duration must be greater than zero")]
    InvalidDuration,
    #[msg("Round start price must be greater than zero")]
    InvalidPrice,
    #[msg("Round window must match the pool duration")]
    InvalidRoundWindow,
    #[msg("Round has not started")]
    RoundNotStarted,
    #[msg("Round is already closed")]
    RoundClosed,
    #[msg("Round is not open")]
    RoundNotOpen,
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
