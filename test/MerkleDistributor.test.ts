import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import chai, { expect } from 'chai'
import { solidity } from 'ethereum-waffle'
import { BigNumber, constants, Contract, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'
import BalanceTree from '../src/balance-tree'
import { parseBalanceMap } from '../src/parse-balance-map'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
}
const gasUsed = {
  MerkleDistributor: {
    twoAccountTree: 81970,
    largerTreeFirstClaim: 85307,
    largerTreeSecondClaim: 68207,
    realisticTreeGas: 95256,
    realisticTreeGasDeeperNode: 95172,
    realisticTreeGasAverageRandom: 78598,
    realisticTreeGasAverageFirst25: 62332,
  },
  MerkleDistributorWithDeadline: {
    twoAccountTree: 82102,
    largerTreeFirstClaim: 85439,
    largerTreeSecondClaim: 68339,
    realisticTreeGas: 95388,
    realisticTreeGasDeeperNode: 95304,
    realisticTreeGasAverageRandom: 78730,
    realisticTreeGasAverageFirst25: 62464,
  },
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

const deployContract = async (factory: ContractFactory, tokenAddress: string, merkleRoot: string, contract: string) => {
  let distributor
  const currentTimestamp = Math.floor(Date.now() / 1000)
  if (contract === 'MerkleDistributorWithDeadline') {
    distributor = await factory.deploy(tokenAddress, merkleRoot, currentTimestamp + 31536000, overrides)
  } else {
    distributor = await factory.deploy(tokenAddress, merkleRoot, overrides)
  }
  return distributor
}

for (const contract of ['ColtMerkleDistributor']) {
  describe(`${contract} tests`, () => {
    let token: Contract
    let distributorFactory: ContractFactory
    let wallet0: SignerWithAddress
    let wallet1: SignerWithAddress
    let wallets: SignerWithAddress[]

    beforeEach(async () => {
      wallets = await ethers.getSigners()
      wallet0 = wallets[0]
      wallet1 = wallets[1]
      const tokenFactory = await ethers.getContractFactory('TestERC20', wallet0)
      token = await tokenFactory.deploy('Token', 'TKN', 0, overrides)
      distributorFactory = await ethers.getContractFactory(contract, wallet0)
    })

    describe('#token', () => {
      it('returns the token address', async () => {
        const distributor = await deployContract(distributorFactory, token.address, ZERO_BYTES32, contract)
        expect(await distributor.token()).to.eq(token.address)
      })
    })

    describe('#merkleRoot', () => {
      it('returns the zero merkle root', async () => {
        const distributor = await deployContract(distributorFactory, token.address, ZERO_BYTES32, contract)
        expect(await distributor.merkleRoot()).to.eq(ZERO_BYTES32)
      })
    })

    describe('#claim', () => {
      it('fails for empty proof', async () => {
        const distributor = await deployContract(distributorFactory, token.address, ZERO_BYTES32, contract)
        await expect(distributor.claim(10, [])).to.be.revertedWith('InvalidProof()')
      })

      it('fails for invalid index', async () => {
        const distributor = await deployContract(distributorFactory, token.address, ZERO_BYTES32, contract)
        await expect(distributor.claim(10, [])).to.be.revertedWith('InvalidProof()')
      })

      describe('two account tree', () => {
        let distributor: Contract
        let tree: BalanceTree
        beforeEach('deploy', async () => {
          tree = new BalanceTree([
            { account: wallet0.address, amount: BigNumber.from(100) },
            { account: wallet1.address, amount: BigNumber.from(101) },
          ])
          distributor = await deployContract(distributorFactory, token.address, tree.getHexRoot(), contract)
          await token.setBalance(distributor.address, 201)
        })

        it('successful claim', async () => {
          const proof0 = tree.getProof(wallet0.address, BigNumber.from(100))
          await expect(distributor.claim(100, proof0, overrides))
            .to.emit(distributor, 'Claimed')
            .withArgs(wallet0.address, 100)
          const proof1 = tree.getProof(wallet1.address, BigNumber.from(101))
          await expect(distributor.connect(wallet1).claim(101, proof1, overrides))
            .to.emit(distributor, 'Claimed')
            .withArgs(wallet1.address, 101)
        })

        it('transfers the token', async () => {
          const proof0 = tree.getProof(wallet0.address, BigNumber.from(100))
          expect(await token.balanceOf(wallet0.address)).to.eq(0)
          await distributor.connect(wallet0).claim(100, proof0, overrides)
          expect(await token.balanceOf(wallet0.address)).to.eq(100)
        })

        it('must have enough to transfer', async () => {
          const proof0 = tree.getProof(wallet0.address, BigNumber.from(100))
          await token.setBalance(distributor.address, 99)
          await expect(distributor.connect(wallet0).claim(100, proof0, overrides)).to.be.revertedWith(
            'ERC20: transfer amount exceeds balance'
          )
        })

        // it('sets #isClaimed', async () => {
        //   const proof0 = tree.getProof(wallet0.address, BigNumber.from(100))
        //   expect(await distributor.isClaimed(0)).to.eq(false)
        //   expect(await distributor.isClaimed(1)).to.eq(false)
        //   await distributor.claim(100, proof0, overrides)
        //   expect(await distributor.isClaimed(0)).to.eq(true)
        //   expect(await distributor.isClaimed(1)).to.eq(false)
        // })

        it('cannot allow two claims', async () => {
          const proof0 = tree.getProof(wallet0.address, BigNumber.from(100))
          await distributor.claim(100, proof0, overrides)
          await expect(distributor.claim(100, proof0, overrides)).to.be.revertedWith(
            'AlreadyClaimed()'
          )
        })

        it('cannot claim more than once: 0 and then 1', async () => {
          await distributor.connect(wallet0).claim(
            100,
            tree.getProof(wallet0.address, BigNumber.from(100)),
            overrides
          )
          await distributor.connect(wallet1).claim(
            101,
            tree.getProof(wallet1.address, BigNumber.from(101)),
            overrides
          )

          await expect(
            distributor.connect(wallet0).claim(
              100,
              tree.getProof(wallet0.address, BigNumber.from(100)),
              overrides
            )
          ).to.be.revertedWith('AlreadyClaimed()')
        })

        it('cannot claim more than once: 1 and then 0', async () => {
          await distributor.connect(wallet1).claim(
            101,
            tree.getProof(wallet1.address, BigNumber.from(101)),
            overrides
          )
          await distributor.connect(wallet0).claim(
            100,
            tree.getProof(wallet0.address, BigNumber.from(100)),
            overrides
          )

          await expect(
            distributor.connect(wallet1).claim(
              101,
              tree.getProof(wallet1.address, BigNumber.from(101)),
              overrides
            )
          ).to.be.revertedWith('AlreadyClaimed()')
        })

        it('cannot claim for address other than proof', async () => {
          const proof0 = tree.getProof(wallet0.address, BigNumber.from(100))
          await expect(distributor.claim(101, proof0, overrides)).to.be.revertedWith(
            'InvalidProof()'
          )
        })

        it('cannot claim more than proof', async () => {
          const proof0 = tree.getProof(wallet0.address, BigNumber.from(100))
          await expect(distributor.claim(101, proof0, overrides)).to.be.revertedWith(
            'InvalidProof()'
          )
        })

        // it('gas', async () => {
        //   const proof = tree.getProof(wallet0.address, BigNumber.from(100))
        //   const tx = await distributor.claim(100, proof, overrides)
        //   const receipt = await tx.wait()
        //   expect(receipt.gasUsed).to.eq(gasUsed[contract as keyof typeof gasUsed].twoAccountTree)
        // })
      })

      describe('larger tree', () => {
        let distributor: Contract
        let tree: BalanceTree
        beforeEach('deploy', async () => {
          tree = new BalanceTree(
            wallets.map((wallet, ix) => {
              return { account: wallet.address, amount: BigNumber.from(ix + 1) }
            })
          )
          distributor = await deployContract(distributorFactory, token.address, tree.getHexRoot(), contract)
          await token.setBalance(distributor.address, 201)
        })

        it('claim index 4', async () => {
          const proof = tree.getProof(wallets[4].address, BigNumber.from(5))
          await expect(distributor.connect(wallets[4]).claim(5, proof, overrides))
            .to.emit(distributor, 'Claimed')
            .withArgs(wallets[4].address, 5)
        })

        it('claim index 9', async () => {
          const proof = tree.getProof(wallets[9].address, BigNumber.from(10))
          await expect(distributor.connect(wallets[9]).claim(10, proof, overrides))
            .to.emit(distributor, 'Claimed')
            .withArgs(wallets[9].address, 10)
        })

        // it('gas', async () => {
        //   const proof = tree.getProof(wallets[9].address, BigNumber.from(10))
        //   const tx = await distributor.claim(wallets[9].address, 10, proof, overrides)
        //   const receipt = await tx.wait()
        //   expect(receipt.gasUsed).to.eq(gasUsed[contract as keyof typeof gasUsed].largerTreeFirstClaim)
        // })

        // it('gas second down about 15k', async () => {
        //   await distributor.claim(
        //     0,
        //     wallets[0].address,
        //     1,
        //     tree.getProof(wallets[0].address, BigNumber.from(1)),
        //     overrides
        //   )
        //   const tx = await distributor.claim(
        //     1,
        //     wallets[1].address,
        //     2,
        //     tree.getProof(wallets[1].address, BigNumber.from(2)),
        //     overrides
        //   )
        //   const receipt = await tx.wait()
        //   expect(receipt.gasUsed).to.eq(gasUsed[contract as keyof typeof gasUsed].largerTreeSecondClaim)
        // })
      })

      describe('realistic size tree', () => {
        let distributor: Contract
        let tree: BalanceTree
        const NUM_LEAVES = 100_000
        const NUM_SAMPLES = 25

        beforeEach('deploy', async () => {
          const elements: { account: string; amount: BigNumber }[] = []
          for (let i = 0; i < NUM_LEAVES; i++) {
            const node = { account: wallet0.address, amount: BigNumber.from(100) }
            elements.push(node)
          }
          tree = new BalanceTree(elements)
          distributor = await deployContract(distributorFactory, token.address, tree.getHexRoot(), contract)
          await token.setBalance(distributor.address, constants.MaxUint256)
        })

        it('proof verification works', () => {
          const root = Buffer.from(tree.getHexRoot().slice(2), 'hex')
          for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
            const proof = tree
              .getProof(wallet0.address, BigNumber.from(100))
              .map((el) => Buffer.from(el.slice(2), 'hex'))
            const validProof = BalanceTree.verifyProof(wallet0.address, BigNumber.from(100), proof, root)
            expect(validProof).to.be.true
          }
        })

        // it('gas', async () => {
        //   const proof = tree.getProof(wallet0.address, BigNumber.from(100))
        //   const tx = await distributor.claim(100, proof, overrides)
        //   const receipt = await tx.wait()
        //   expect(receipt.gasUsed).to.eq(gasUsed[contract as keyof typeof gasUsed].realisticTreeGas)
        // })
        // it('gas deeper node', async () => {
        //   const proof = tree.getProof(wallet0.address, BigNumber.from(100))
        //   const tx = await distributor.claim(100, proof, overrides)
        //   const receipt = await tx.wait()
        //   expect(receipt.gasUsed).to.eq(gasUsed[contract as keyof typeof gasUsed].realisticTreeGasDeeperNode)
        // })
        // it('gas average random distribution', async () => {
        //   let total: BigNumber = BigNumber.from(0)
        //   let count: number = 0
        //   for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
        //     const proof = tree.getProof(wallet0.address, BigNumber.from(100))
        //     const tx = await distributor.claim(100, proof, overrides)
        //     const receipt = await tx.wait()
        //     total = total.add(receipt.gasUsed)
        //     count++
        //   }
        //   const average = total.div(count)
        //   expect(average).to.eq(gasUsed[contract as keyof typeof gasUsed].realisticTreeGasAverageRandom)
        // })
        // // this is what we gas golfed by packing the bitmap
        // it('gas average first 25', async () => {
        //   let total: BigNumber = BigNumber.from(0)
        //   let count: number = 0
        //   for (let i = 0; i < 25; i++) {
        //     const proof = tree.getProof(wallet0.address, BigNumber.from(100))
        //     const tx = await distributor.claim(100, proof, overrides)
        //     const receipt = await tx.wait()
        //     total = total.add(receipt.gasUsed)
        //     count++
        //   }
        //   const average = total.div(count)
        //   expect(average).to.eq(gasUsed[contract as keyof typeof gasUsed].realisticTreeGasAverageFirst25)
        // })

        it('no double claims in random distribution', async () => {
          for (let i = 0; i < 25; i += Math.floor(Math.random() * (NUM_LEAVES / NUM_SAMPLES))) {
            const proof = tree.getProof(wallet0.address, BigNumber.from(100))
            await distributor.claim(100, proof, overrides)
            await expect(distributor.claim(100, proof, overrides)).to.be.revertedWith(
              'AlreadyClaimed()'
            )
          }
        })
      })

      describe('parseBalanceMap', () => {
        let distributor: Contract
        let claims: {
          [account: string]: {
            index: number
            amount: string
            proof: string[]
          }
        }
        beforeEach('deploy', async () => {
          const { claims: innerClaims, merkleRoot, tokenTotal } = parseBalanceMap({
            [wallet0.address]: 200,
            [wallet1.address]: 300,
            [wallets[2].address]: 250,
          })
          expect(tokenTotal).to.eq('0x02ee') // 750
          claims = innerClaims
          distributor = await deployContract(distributorFactory, token.address, merkleRoot, contract)
          await token.setBalance(distributor.address, tokenTotal)
        })

        it('check the proofs is as expected', () => {
          expect(claims).to.deep.eq({
            [wallet0.address]: {
              index: 2,
              amount: '0xc8',
              proof: [
                '0x643d24f16c2e69b0124489d985ec4c3a36004090fab29937407b75d6065267a4'
              ],
            },
            [wallet1.address]: {
              index: 1,
              amount: '0x012c',
              proof: [
                '0xc66c0b501e5220706010163c752777a6a915a6839aeb627a5eda2f01bac0d721',
                '0xcf7e588ddb5e2818a1e5c447ff69e12bda6d36b253e7c274aa86c318809b898a',
              ],
            },
            [wallets[2].address]: {
              index: 0,
              amount: '0xfa',
              proof: ['0x60b804e11554b6c0d72577a181152f1554fd18169d7919971a6f80cd51eccb58',
                '0xcf7e588ddb5e2818a1e5c447ff69e12bda6d36b253e7c274aa86c318809b898a'],
            },
          })
        })

        // it('all claims work exactly once', async () => {
        //   for (let account in claims) {
        //     const claim = claims[account]
        //     await expect(distributor.claim(claim.index, account, claim.amount, claim.proof, overrides))
        //       .to.emit(distributor, 'Claimed')
        //       .withArgs(claim.index, account, claim.amount)
        //     await expect(
        //       distributor.claim(claim.index, account, claim.amount, claim.proof, overrides)
        //     ).to.be.revertedWith('AlreadyClaimed()')
        //   }
        //   expect(await token.balanceOf(distributor.address)).to.eq(0)
        // })
      })
    })
  })
}