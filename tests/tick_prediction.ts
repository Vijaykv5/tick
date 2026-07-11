import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import BN from 'bn.js'
import assert from 'node:assert'

import type { TickPrediction } from '../target/types/tick_prediction'

describe('tick_prediction', () => {
  anchor.setProvider(anchor.AnchorProvider.env())

  const program = anchor.workspace.tickPrediction as Program<TickPrediction>
  const authority = anchor.getProvider().publicKey

  function poolPda(symbol: string) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), Buffer.from(symbol)],
      program.programId,
    )[0]
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

  it('creates BTC, SOL, and ETH pools', async () => {
    for (const symbol of ['BTC', 'SOL', 'ETH']) {
      const pool = poolPda(symbol)

      await program.methods
        .initializePool(symbol, new BN(60))
        .accounts({ authority, pool })
        .rpc()

      const account = await program.account.pool.fetch(pool)
      assert.equal(account.authority.toBase58(), authority.toBase58())
      assert.equal(Buffer.from(account.symbol).toString('utf8').replace(/\0/g, ''), symbol)
      assert.equal(account.durationSeconds.toNumber(), 60)
    }
  })

  it('opens a 1-minute BTC round and records one up prediction', async () => {
    const symbol = 'BTC'
    const pool = poolPda(symbol)
    const roundId = new BN(1)
    const round = roundPda(pool, roundId)
    const prediction = predictionPda(round, authority)
    const now = Math.floor(Date.now() / 1000)

    await program.methods
      .openRound(roundId, new BN(6417406), new BN(now - 1), new BN(now + 59))
      .accounts({ authority, pool, round })
      .rpc()

    await program.methods
      .placePrediction({ up: {} })
      .accounts({ prediction, predictor: authority, round })
      .rpc()

    const roundAccount = await program.account.round.fetch(round)
    const predictionAccount = await program.account.prediction.fetch(prediction)

    assert.equal(roundAccount.pool.toBase58(), pool.toBase58())
    assert.equal(roundAccount.roundId.toNumber(), 1)
    assert.equal(roundAccount.startPrice.toNumber(), 6417406)
    assert.deepEqual(predictionAccount.direction, { up: {} })
    assert.equal(predictionAccount.predictor.toBase58(), authority.toBase58())
  })

  it('rejects a duplicate prediction by the same wallet for the same round', async () => {
    const symbol = 'BTC'
    const pool = poolPda(symbol)
    const roundId = new BN(1)
    const round = roundPda(pool, roundId)
    const prediction = predictionPda(round, authority)

    await expectRejects(
      program.methods
        .placePrediction({ up: {} })
        .accounts({ prediction, predictor: authority, round })
        .rpc(),
      'expected duplicate prediction to fail',
    )
  })

  it('rejects prediction after the round end time', async () => {
    const symbol = 'BTC'
    const pool = poolPda(symbol)
    const roundId = new BN(2)
    const round = roundPda(pool, roundId)
    const prediction = predictionPda(round, authority)
    const now = Math.floor(Date.now() / 1000)

    await program.methods
      .openRound(roundId, new BN(6417406), new BN(now - 120), new BN(now - 60))
      .accounts({ authority, pool, round })
      .rpc()

    await expectRejects(
      program.methods
        .placePrediction({ down: {} })
        .accounts({ prediction, predictor: authority, round })
        .rpc(),
      'expected expired round prediction to fail',
    )
  })
})
