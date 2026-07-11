import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import { createAssociatedTokenAccount, createMint, getAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import BN from 'bn.js'
import assert from 'node:assert'

import type { TickPrediction } from '../target/types/tick_prediction'

describe('tick_prediction', () => {
  anchor.setProvider(anchor.AnchorProvider.env())

  const provider = anchor.getProvider() as anchor.AnchorProvider
  const program = anchor.workspace.tickPrediction as Program<TickPrediction>
  const authority = provider.publicKey
  let usdcMint: anchor.web3.PublicKey
  let authorityUsdc: anchor.web3.PublicKey
  let user: anchor.web3.Keypair
  let userUsdc: anchor.web3.PublicKey

  function poolPda(symbol: string) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('pool_v2'), Buffer.from(symbol)],
      program.programId,
    )[0]
  }

  function vaultAuthorityPda(pool: anchor.web3.PublicKey) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vault_authority'), pool.toBuffer()],
      program.programId,
    )[0]
  }

  function vaultPda(pool: anchor.web3.PublicKey) {
    return anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('vault'), pool.toBuffer()], program.programId)[0]
  }

  function roundPda(pool: anchor.web3.PublicKey, roundId: BN) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('round'), pool.toBuffer(), roundId.toArrayLike(Buffer, 'le', 8)],
      program.programId,
    )[0]
  }

  function predictionPda(round: anchor.web3.PublicKey, predictor: anchor.web3.PublicKey) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('prediction'), round.toBuffer(), predictor.toBuffer()],
      program.programId,
    )[0]
  }

  async function expectRejects(action: Promise<unknown>, message: string) {
    try {
      await action
      assert.fail(message)
    } catch (error) {
      assert.ok(error)
    }
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function getValidatorNow() {
    const slot = await provider.connection.getSlot()
    return (await provider.connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000)
  }

  async function waitForValidatorTime(targetTimestamp: number) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if ((await getValidatorNow()) >= targetTimestamp) {
        return
      }

      const transaction = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: authority,
          lamports: 1,
          toPubkey: user.publicKey,
        }),
      )

      await provider.sendAndConfirm(transaction)
      await sleep(500)
    }

    assert.fail(`validator time did not reach ${targetTimestamp}`)
  }

  before(async () => {
    user = anchor.web3.Keypair.generate()

    const signature = await provider.connection.requestAirdrop(user.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL)
    await provider.connection.confirmTransaction(signature)

    usdcMint = await createMint(provider.connection, provider.wallet.payer, authority, null, 6)
    authorityUsdc = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, usdcMint, authority)
    userUsdc = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, usdcMint, user.publicKey)

    await mintTo(provider.connection, provider.wallet.payer, usdcMint, authorityUsdc, authority, 100_000_000)
    await mintTo(provider.connection, provider.wallet.payer, usdcMint, userUsdc, authority, 10_000_000)
  })

  it('creates BTC, SOL, and ETH pools with USDC vaults', async () => {
    const poolDurations = [
      { duration: 60, predictionWindow: 30, symbol: 'BTC' },
      { duration: 4, predictionWindow: 3, symbol: 'SOL' },
      { duration: 4, predictionWindow: 3, symbol: 'ETH' },
    ]

    for (const { duration, predictionWindow, symbol } of poolDurations) {
      const pool = poolPda(symbol)
      const vaultAuthority = vaultAuthorityPda(pool)
      const vault = vaultPda(pool)

      await program.methods
        .initializePool(symbol, new BN(duration), new BN(predictionWindow))
        .accounts({
          authority,
          pool,
          tokenProgram: TOKEN_PROGRAM_ID,
          usdcMint,
          vault,
          vaultAuthority,
        })
        .rpc()

      await mintTo(provider.connection, provider.wallet.payer, usdcMint, vault, authority, 50_000_000)

      const account = await program.account.pool.fetch(pool)
      assert.equal(account.authority.toBase58(), authority.toBase58())
      assert.equal(Buffer.from(account.symbol).toString('utf8').replace(/\0/g, ''), symbol)
      assert.equal(account.durationSeconds.toNumber(), duration)
      assert.equal(account.predictionWindowSeconds.toNumber(), predictionWindow)
      assert.equal(account.usdcMint.toBase58(), usdcMint.toBase58())
      assert.equal(account.vault.toBase58(), vault.toBase58())
    }
  })

  it('opens a round, records one tile prediction, and transfers a $1 stake', async () => {
    const symbol = 'BTC'
    const pool = poolPda(symbol)
    const vault = vaultPda(pool)
    const roundId = new BN(1)
    const round = roundPda(pool, roundId)
    const prediction = predictionPda(round, user.publicKey)
    const now = await getValidatorNow()
    const vaultBefore = await getAccount(provider.connection, vault)

    await program.methods
      .openRound(roundId, new BN(6417406), new BN(now - 1), new BN(now + 59))
      .accounts({ authority, pool, round })
      .rpc()

    await program.methods
      .placeTilePrediction(3)
      .accounts({
        pool,
        prediction,
        predictor: user.publicKey,
        predictorTokenAccount: userUsdc,
        round,
        tokenProgram: TOKEN_PROGRAM_ID,
        usdcMint,
        vault,
      })
      .signers([user])
      .rpc()

    const vaultAfter = await getAccount(provider.connection, vault)
    const predictionAccount = await program.account.tilePrediction.fetch(prediction)

    assert.equal(Number(vaultAfter.amount - vaultBefore.amount), 1_000_000)
    assert.equal(predictionAccount.tileIndex, 3)
    assert.equal(predictionAccount.stakeAmount.toNumber(), 1_000_000)
    assert.equal(predictionAccount.multiplierBps, 1_000)
    assert.equal(predictionAccount.claimed, false)
  })

  it('rejects a duplicate tile prediction by the same wallet for the same round', async () => {
    const symbol = 'BTC'
    const pool = poolPda(symbol)
    const vault = vaultPda(pool)
    const roundId = new BN(1)
    const round = roundPda(pool, roundId)
    const prediction = predictionPda(round, user.publicKey)

    await expectRejects(
      program.methods
        .placeTilePrediction(4)
        .accounts({
          pool,
          prediction,
          predictor: user.publicKey,
          predictorTokenAccount: userUsdc,
          round,
          tokenProgram: TOKEN_PROGRAM_ID,
          usdcMint,
          vault,
        })
        .signers([user])
        .rpc(),
      'expected duplicate tile prediction to fail',
    )
  })

  it('rejects prediction after the prediction window', async () => {
    const symbol = 'BTC'
    const pool = poolPda(symbol)
    const vault = vaultPda(pool)
    const roundId = new BN(2)
    const round = roundPda(pool, roundId)
    const prediction = predictionPda(round, user.publicKey)
    const now = await getValidatorNow()

    await program.methods
      .openRound(roundId, new BN(6417406), new BN(now - 40), new BN(now + 20))
      .accounts({ authority, pool, round })
      .rpc()

    await expectRejects(
      program.methods
        .placeTilePrediction(4)
        .accounts({
          pool,
          prediction,
          predictor: user.publicKey,
          predictorTokenAccount: userUsdc,
          round,
          tokenProgram: TOKEN_PROGRAM_ID,
          usdcMint,
          vault,
        })
        .signers([user])
        .rpc(),
      'expected closed prediction window to reject tile prediction',
    )
  })

  it('settles the final-price tile and lets a winner claim once', async () => {
    const symbol = 'SOL'
    const pool = poolPda(symbol)
    const vault = vaultPda(pool)
    const vaultAuthority = vaultAuthorityPda(pool)
    const roundId = new BN(3)
    const round = roundPda(pool, roundId)
    const prediction = predictionPda(round, user.publicKey)
    const now = await getValidatorNow()
    await program.methods
      .openRound(roundId, new BN(100_000), new BN(now), new BN(now + 4))
      .accounts({ authority, pool, round })
      .rpc()

    await program.methods
      .placeTilePrediction(0)
      .accounts({
        pool,
        prediction,
        predictor: user.publicKey,
        predictorTokenAccount: userUsdc,
        round,
        tokenProgram: TOKEN_PROGRAM_ID,
        usdcMint,
        vault,
      })
      .signers([user])
      .rpc()

    const userBeforeClaim = await getAccount(provider.connection, userUsdc)

    await waitForValidatorTime(now + 4)

    await program.methods.settleRound(new BN(99_600)).accounts({ authority, pool, round }).rpc()

    const roundAccount = await program.account.round.fetch(round)
    assert.deepEqual(roundAccount.status, { settled: {} })
    assert.equal(roundAccount.winningTileIndex, 0)

    await program.methods
      .claimPayout()
      .accounts({
        authority,
        claimantTokenAccount: userUsdc,
        pool,
        prediction,
        round,
        tokenProgram: TOKEN_PROGRAM_ID,
        usdcMint,
        vault,
        vaultAuthority,
      })
      .rpc()

    const userAfter = await getAccount(provider.connection, userUsdc)
    const predictionAccount = await program.account.tilePrediction.fetch(prediction)
    assert.equal(Number(userAfter.amount - userBeforeClaim.amount), 1_300_000)
    assert.equal(predictionAccount.claimed, true)

    await expectRejects(
      program.methods
        .claimPayout()
        .accounts({
          authority,
          claimantTokenAccount: userUsdc,
          pool,
          prediction,
          round,
          tokenProgram: TOKEN_PROGRAM_ID,
          usdcMint,
          vault,
          vaultAuthority,
        })
        .rpc(),
      'expected second claim to fail',
    )
  })

  it('rejects loser claims', async () => {
    const symbol = 'ETH'
    const pool = poolPda(symbol)
    const vault = vaultPda(pool)
    const vaultAuthority = vaultAuthorityPda(pool)
    const roundId = new BN(4)
    const round = roundPda(pool, roundId)
    const prediction = predictionPda(round, user.publicKey)
    const now = await getValidatorNow()

    await program.methods
      .openRound(roundId, new BN(100_000), new BN(now), new BN(now + 4))
      .accounts({ authority, pool, round })
      .rpc()

    await program.methods
      .placeTilePrediction(0)
      .accounts({
        pool,
        prediction,
        predictor: user.publicKey,
        predictorTokenAccount: userUsdc,
        round,
        tokenProgram: TOKEN_PROGRAM_ID,
        usdcMint,
        vault,
      })
      .signers([user])
      .rpc()

    await waitForValidatorTime(now + 4)

    await program.methods.settleRound(new BN(100_000)).accounts({ authority, pool, round }).rpc()

    await expectRejects(
      program.methods
        .claimPayout()
        .accounts({
          authority,
          claimantTokenAccount: userUsdc,
          pool,
          prediction,
          round,
          tokenProgram: TOKEN_PROGRAM_ID,
          usdcMint,
          vault,
          vaultAuthority,
        })
        .rpc(),
      'expected loser claim to fail',
    )
  })
})
