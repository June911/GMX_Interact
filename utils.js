import { ethers } from "ethers"

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function toUsd(value) {
    const normalizedValue = parseInt(value * Math.pow(10, 10))
    return ethers.BigNumber.from(normalizedValue).mul(ethers.BigNumber.from(10).pow(20))
}

export default { sleep, toUsd }