import { ethers } from "ethers"
import 'dotenv/config';
import { sleep, toUsd } from './utils.js'

import addresses from './addresses.json' assert {type: "json"};
import reader_abi from './abi/reader_abi.json' assert { type: 'json' };
import router_abi from './abi/router_abi.json' assert {type: "json"};

const READER_ADDRESS = process.env.READER_ADDRESS;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const ARBITURM_ALCHEMY_RPC = `https://arb-mainnet.g.alchemy.com/v2/${process.env.ARBITURM_ALCHEMY_API_KEY}`;

// connect to web 
const provider = new ethers.providers.JsonRpcProvider(ARBITURM_ALCHEMY_RPC)
let privateKey = addresses[0]["private_key"];
let signer = new ethers.Wallet(privateKey, provider)

console.log('Your wallet address:', signer.address)
console.log('The Connected network', await provider.getNetwork())

// contract 
// if only read -> provider; if need to sign, signer 
const reader_contract = new ethers.Contract(READER_ADDRESS, reader_abi, provider);
const router_contract = new ethers.Contract(ROUTER_ADDRESS, router_abi, signer);

let tokenIn = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"; // address of token that will be given (WETH)
let tokenOut = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"; // address of token to be received (USDC)

// get swap amounts before execution
async function getSwapAmount(amountIn) {
    const MaxAmountIn = await reader_contract.getMaxAmountIn(VAULT_ADDRESS, tokenIn, tokenOut);
    console.log(`MaxAmountIn: ${ethers.utils.formatEther(MaxAmountIn, "wei")} eth`);

    // AmountOut is after fees 
    // if USDC, amount out should be divived by 6 (Decimals)
    if (amountIn.lt(MaxAmountIn)) {
        const [AmountOut, FeeAmount] = await reader_contract.getAmountOut(VAULT_ADDRESS, tokenIn, tokenOut, amountIn);
        console.log(`AmountOut: ${ethers.utils.formatUnits(AmountOut, 6)} USDC`);
        console.log(`FeeAmount: ${ethers.utils.formatUnits(FeeAmount, 6)} USDC`);
        return AmountOut
    } else {
        console.log("not enough liquidity to trade")
    }
}

// execute a swap
async function swap(signer, amountIn) {
    let _path = [tokenIn, tokenOut];
    let _receiver = signer.address;
    let minAmountOut;
    console.log(_receiver)
    console.log('Your wallet balance:', await signer.getBalance())

    // approve the Router contract for the token 
    // check if token approved
    let isApproved = await router_contract.approvedPlugins(_receiver, tokenIn);
    if (!isApproved) {
        const txApprove = await router_contract.approvePlugin(tokenIn);
        console.log(`txApprove hash: ${txApprove.hash}`);
        await txApprove.wait();
        isApproved = await router_contract.approvedPlugins(_receiver, tokenIn);
        console.log("Approved successfully!");

    } else {
        console.log("Already approved.");
    }

    // get swap amounts before execution
    const estimatedAmountOut = await getSwapAmount(amountIn)
    // minimum expected output amount 
    minAmountOut = ethers.BigNumber.from(
        (Math.round(estimatedAmountOut * 0.99)).toString()
    );
    console.log(`minAmountOut: ${ethers.utils.formatUnits(minAmountOut, 6)} USDC`);

    // swap
    const tx = await router_contract.swapETHToTokens(
        _path, minAmountOut.toString(), _receiver,
        { value: amountIn }
    );
    console.log(tx.hash);
    await tx.wait();
}


// execute a swap
async function main() {
    let amountIn = ethers.utils.parseEther("0.001", "eth");
    console.log(`amountIn: ${amountIn}`);
    // let amountIn = ethers.utils.parseUnits("100", 6);
    // let amountIn = "1000000000000";
    // console.log(amountIn.lt(ethers.utils.parseEther("0.2", "eth")));
    // getSwapAmount(amountIn)
    swap(signer, amountIn);
}

main()