import { ethers } from "ethers"
import 'dotenv/config';
import { sleep, toUsd } from './utils.js'


import addresses from './addresses.json' assert {type: "json"};
import reader_abi from './abi/reader_abi.json' assert { type: 'json' };
import router_abi from './abi/router_abi.json' assert {type: "json"};
import position_router_abi from './abi/position_router_abi.json' assert {type: "json"};
import price_feed_abi from './abi/price_feed_abi.json' assert {type: "json"};

const READER_ADDRESS = process.env.READER_ADDRESS;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const POSITION_ROUTER_ADDRESS = process.env.POSITION_ROUTER_ADDRESS;
const VAULT_PRICE_FEED_ADDRESS = process.env.VAULT_PRICE_FEED_ADDRESS;

const ARBITURM_ALCHEMY_RPC = `https://arb-mainnet.g.alchemy.com/v2/${process.env.ARBITURM_ALCHEMY_API_KEY}`;

// connect to web 
const provider = new ethers.providers.JsonRpcProvider(ARBITURM_ALCHEMY_RPC)
let privateKey = addresses[0]["private_key"];
let signer = new ethers.Wallet(privateKey, provider)

console.log('Your wallet address:', signer.address)

// contract 
// if only read -> provider; if need to sign, signer 
const reader_contract = new ethers.Contract(READER_ADDRESS, reader_abi, provider);
const router_contract = new ethers.Contract(ROUTER_ADDRESS, router_abi, signer);
const position_router_contract = new ethers.Contract(POSITION_ROUTER_ADDRESS, position_router_abi, signer);
const priceFeed_contract = new ethers.Contract(VAULT_PRICE_FEED_ADDRESS, price_feed_abi, signer);

let tokenIn = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"; // WETH
let indexToken = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"; // the address of the token you want to long or short (WETH)

// get price 
async function get_price() {
    let _maximise = false;
    let _includeAmmPrice = true;
    let _input = false;
    const price = await priceFeed_contract.getPrice(tokenIn, _maximise, _includeAmmPrice, _input);

    return price;
}

// get position
async function get_position(signer) {
    let _account = signer.address;
    let _collateralTokens = [tokenIn];
    let _indexTokens = [indexToken];
    let _isLong = [true];

    let positions = await reader_contract.getPositions(
        VAULT_ADDRESS,
        _account,
        _collateralTokens,
        _indexTokens,
        _isLong,
    );

    // size, collateral, averagePrice, entryFundingRate, realisedPnl, hasRealisedProfit, lastIncreasedTime, hasProfit, delta
    return positions;

}


// execute a leverage trade
async function leverageTradeETHLong(signer, amountIn, sizeDelta) {
    let _path = [tokenIn]; // _path allows swapping to the collateralToken if needed
    let _minOut = 0; // the min amount of collateralToken to swap for; zero if no swap is required
    let _isLong = true; // whether to long or short
    let _executionFee = await position_router_contract.minExecutionFee() // (WAS 600000000000000 NOW 2000000000000000)
    let _referralCode = "0x0000000000000000000000000000000000000000000000000000000000000000";
    let _receiver = signer.address;

    let currentPirce = await get_price();
    // the USD value of the max (for longs) or min (for shorts) index price accepted when opening the position
    let acceptablePrice = toUsd(ethers.utils.formatUnits(currentPirce, 30) * 1.01);
    console.log(`acceptablePrice: ${acceptablePrice}`);

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

    // open/increase position
    const tx = await position_router_contract.createIncreasePositionETH(
        _path,
        indexToken,
        _minOut,
        sizeDelta,
        _isLong,
        acceptablePrice,
        _executionFee,
        _referralCode,
        { value: amountIn }
    )
    console.log(`Transaction hash: ${tx.hash}`);
    await tx.wait();
}


async function leverageTradeETHCloseLong(signer) {
    let _path = [tokenIn]; // _path allows swapping to the collateralToken if needed
    let _indexTokens = indexToken;
    let _minOut = 0; // the min amount of collateralToken to swap for; zero if no swap is required
    let _isLong = true; // whether to long or short
    let _executionFee = await position_router_contract.minExecutionFee() // show be larger than or equal to minExecutionFee
    let _receiver = signer.address;
    let _withdrawETH = true;

    let positions = await get_position(signer);
    let _sizeDelta = positions[0]; // the difference in size 
    let _collateralDelta = 0; // the difference in collateral 

    let _currentPirce = await get_price();
    let _acceptablePrice = toUsd(ethers.utils.formatUnits(_currentPirce, 30) * 0.99); // the USD value of the max (for longs) or min (for shorts) index price accepted when opening the position

    console.log("_executionFee", _executionFee.toString());
    console.log(`_sizeDelta: ${_sizeDelta}`)
    console.log(`_collateralDelta: ${_collateralDelta}`)
    console.log(`acceptablePrice: ${_acceptablePrice}`);


    // close/decrease position
    if (_sizeDelta > 0) {
        const tx = await position_router_contract.createDecreasePosition(
            _path,
            _indexTokens,
            _collateralDelta,
            _sizeDelta,
            _isLong,
            _receiver,
            _acceptablePrice,
            _minOut,
            _executionFee,
            _withdrawETH,
            { value: _executionFee } // closing fees
        )
        console.log(`Transaction hash: ${tx.hash}`);
        await tx.wait();
    }
}

// execute a leverage trade
async function main() {
    let amountIn = ethers.utils.parseEther("0.01", "eth");
    let sizeDelta = toUsd(15); // the USD value of the change in position size = * 10^30

    leverageTradeETHLong(signer, amountIn, sizeDelta);

    // sleep some time to close position
    sleep(200000);

    leverageTradeETHCloseLong(signer);
}

main()