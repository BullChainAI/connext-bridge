import { useState, useEffect } from 'react'
import { useSelector, useDispatch, shallowEqual } from 'react-redux'

import _ from 'lodash'
import moment from 'moment'
import { getDeployedTransactionManagerContract } from '@connext/nxtp-sdk'
import { getRandomBytes32, multicall } from '@connext/nxtp-utils'
import ERC20 from '@connext/nxtp-contracts/artifacts/contracts/interfaces/IERC20Minimal.sol/IERC20Minimal.json'
import contractDeployments from '@connext/nxtp-contracts/deployments.json'
import { constants, Contract } from 'ethers'
import BigNumber from 'bignumber.js'
import { Img } from 'react-image'
import Loader from 'react-loader-spinner'
import Switch from 'react-switch'
import Linkify from 'react-linkify'
import parse from 'html-react-parser'
import { MdSwapVerticalCircle, MdSwapHorizontalCircle, MdRefresh } from 'react-icons/md'
import { IoWallet } from 'react-icons/io5'
import { IoMdInformationCircle } from 'react-icons/io'
import { BsFillQuestionCircleFill } from 'react-icons/bs'
import { BiMessageError, BiMessageDots, BiMessageCheck, BiMessageDetail, BiChevronRight, BiChevronUp, BiInfinite, BiLock } from 'react-icons/bi'
import { FaCheckCircle, FaClock, FaTimesCircle } from 'react-icons/fa'
import { TiArrowRight, TiWarning } from 'react-icons/ti'
import { HiSpeakerphone } from 'react-icons/hi'

import Network from './network'
import Asset from './asset'
import AdvancedOptions from './advanced-options'
import TransactionState from './transaction-state'
import ActiveTransactions from './active-transactions'
import Faucets from './faucets'
import Wallet from '../wallet'
import Popover from '../popover'
import Alert from '../alerts'
import Notification from '../notifications'
import ModalConfirm from '../modals/modal-confirm'
import Copy from '../copy'

import { balances as getBalances, contracts as getContracts } from '../../lib/api/covalent'
import { assetBalances } from '../../lib/api/subgraph'
import { domains } from '../../lib/api/ens'
import { chainTitle } from '../../lib/object/chain'
import { getApproved, approve } from '../../lib/object/contract'
import { currency_symbol } from '../../lib/object/currency'
import { smallNumber, numberFormat, ellipseAddress } from '../../lib/utils'

import { CHAINS_STATUS_DATA, CHAINS_STATUS_SYNC_DATA, BALANCES_DATA, TOKENS_DATA, MAX_TRANSFERS_DATA, ENS_DATA } from '../../reducers/types'

const refresh_estimated_fees_second = Number(process.env.NEXT_PUBLIC_REFRESH_ESTIMATED_FEES_SECOND)
const expiry_hours = Number(process.env.NEXT_PUBLIC_EXPIRY_HOURS)
const bid_expires_second = Number(process.env.NEXT_PUBLIC_BID_EXPIRES_SECOND)
const approve_response_countdown_second = 10

BigNumber.config({ DECIMAL_PLACES: Number(process.env.NEXT_PUBLIC_MAX_BIGNUMBER_EXPONENTIAL_AT), EXPONENTIAL_AT: [-7, Number(process.env.NEXT_PUBLIC_MAX_BIGNUMBER_EXPONENTIAL_AT)] })

const check_balances = true && !['testnet'].includes(process.env.NEXT_PUBLIC_NETWORK)

export default function CrosschainBridge() {
  const dispatch = useDispatch()
  const { chains, assets, announcement, chains_status, balances, tokens, max_transfers, ens, wallet, sdk, rpcs, preferences } = useSelector(state => ({ chains: state.chains, assets: state.assets, announcement: state.announcement, chains_status: state.chains_status, balances: state.balances, tokens: state.tokens, max_transfers: state.max_transfers, ens: state.ens, wallet: state.wallet, sdk: state.sdk, rpcs: state.rpcs, preferences: state.preferences }), shallowEqual)
  const { chains_data } = { ...chains }
  const { assets_data } = { ...assets }
  const { announcement_data } = { ...announcement }
  const { chains_status_data } = { ...chains_status }
  const { balances_data } = { ...balances }
  const { tokens_data } = { ...tokens }
  const { max_transfers_data } = { ...max_transfers }
  const { ens_data } = { ...ens }
  const { wallet_data } = { ...wallet }
  const { web3_provider, signer, chain_id, address } = { ...wallet_data }
  const { sdk_data } = { ...sdk }
  const { rpcs_data } = { ...rpcs }
  const { theme } = { ...preferences }

  const defaultInfiniteApproval = false
  const defaultAdvancedOptions = {
    receiving_address: '',
    contract_address: '',
    call_data: '',
    preferred_router: '',
  }

  const [controller, setController] = useState(new AbortController())

  const [swapConfig, setSwapConfig] = useState({})
  const [infiniteApproval, setInfiniteApproval] = useState(defaultInfiniteApproval)
  const [advancedOptions, setAdvancedOptions] = useState(defaultAdvancedOptions)

  const [estimateTrigger, setEstimateTrigger] = useState(null)

  const [tokenApproved, setTokenApproved] = useState(null)
  const [tokenApproveResponse, setTokenApproveResponse] = useState(null)
  const [tokenApproveResponseCountDown, setTokenApproveResponseCountDown] = useState(null)

  const [fees, setFees] = useState(null)
  const [estimatingFees, setEstimatingFees] = useState(null)
  const [refreshEstimatedFeesSecond, setRefreshEstimatedFeesSecond] = useState(null)

  const [estimatedAmount, setEstimatedAmount] = useState(null)
  const [estimatingAmount, setEstimatingAmount] = useState(null)
  const [estimatedAmountResponse, setEstimatedAmountResponse] = useState(null)
  const [bidExpiresSecond, setBidExpiresSecond] = useState(null)
  const [numReceivedBid, setNumReceivedBid] = useState(null)
  const [confirmFeesCollapsed, setConfirmFeesCollapsed] = useState(null)

  const [startingSwap, setStartingSwap] = useState(null)
  const [swapData, setSwapData] = useState(null)
  const [swapResponse, setSwapResponse] = useState(null)

  const [activeTransactionOpen, setActiveTransactionOpen] = useState(null)

  // wallet
  useEffect(() => {
    if (chain_id && (!swapConfig.fromChainId || !swapConfig.toChainId) && swapConfig.toChainId !== chain_id) {
      if (chains_data?.findIndex(_chain => !_chain?.disabled && _chain?.chain_id === chain_id) > -1) {
        setSwapConfig({ ...swapConfig, fromChainId: chain_id })
      }

      getChainBalances(chain_id)
    }
  }, [chain_id, chains_data])

  useEffect(() => {
    dispatch({
      type: BALANCES_DATA,
      value: null,
    })

    if (address) {
      // if (swapConfig.fromAssetId || swapConfig.toAssetId) {
        if (swapConfig.fromChainId) {
          getChainBalances(swapConfig.fromChainId)
        }
        if (swapConfig.toChainId) {
          getChainBalances(swapConfig.toChainId)
        }
      // }
    }
    else {
      reset()
    }

    getDomain(address)
  }, [address])

  useEffect(() => {
    const getData = () => {
      if (address && !startingSwap && !swapData && !['pending'].includes(tokenApproveResponse?.status)) {
        if (swapConfig.fromChainId) {
          getChainBalances(swapConfig.fromChainId)
        }
        if (swapConfig.toChainId) {
          getChainBalances(swapConfig.toChainId)
        }
      }
    }

    getData()

    const interval = setInterval(() => getData(), 0.25 * 60 * 1000)
    return () => clearInterval(interval)
  }, [rpcs_data])
  // wallet

  // estimate
  useEffect(() => {
    let _controller

    if (estimateTrigger) {
      controller?.abort()

      _controller = new AbortController()
      setController(_controller)

      estimate(_controller)
    }

    return () => {
      _controller?.abort()
    }
  }, [estimateTrigger])

  useEffect(async () => {
    setEstimateTrigger(moment().valueOf())
  }, [address, swapConfig, advancedOptions])
  // estimate

  // fees
  useEffect(() => {
    if (typeof refreshEstimatedFeesSecond === 'number') {
      if (refreshEstimatedFeesSecond === 0) {
        if (typeof swapConfig.amount !== 'number') {
          setEstimateTrigger(moment().valueOf())
        }
      }
      else { 
        const interval = setInterval(() => {
          if (refreshEstimatedFeesSecond - 1 > -1) {
            setRefreshEstimatedFeesSecond(refreshEstimatedFeesSecond - 1)
          }
        }, 1000)
        return () => clearInterval(interval)
      }
    }
  }, [refreshEstimatedFeesSecond])

  useEffect(() => {
    if (typeof estimatingFees === 'boolean' && !estimatingFees) {
      setRefreshEstimatedFeesSecond(refresh_estimated_fees_second)
    }
  }, [estimatingFees])
  // fees

  // bid
  useEffect(() => {
    if (typeof bidExpiresSecond === 'number') {
      if (bidExpiresSecond === -1) {
        setBidExpiresSecond(bid_expires_second)
        setNumReceivedBid((numReceivedBid || 0) + 1)
      }
      else {
        const interval = setInterval(() => {
          if (bidExpiresSecond - 1 > -2) {
            setBidExpiresSecond(bidExpiresSecond - 1)
          }
        }, 1000)
        return () => clearInterval(interval)
      }
    }
  }, [bidExpiresSecond])
  // bid

  // approve
  useEffect(async () => {
    setTokenApproveResponse(null)

    const _approved = await isTokenApproved()
    setTokenApproved(_approved)
  }, [address, chain_id, swapConfig])

  useEffect(() => {
    if (tokenApproved === true || (tokenApproved && tokenApproved?.toNumber() >= constants.MaxUint256)) {
      setInfiniteApproval(true)
    }
  }, [tokenApproved])

  useEffect(() => {
    if (typeof tokenApproveResponseCountDown === 'number') {
      if (tokenApproveResponseCountDown === 0) {
        setTokenApproveResponse(null)
      }
      else { 
        const interval = setInterval(() => {
          if (tokenApproveResponseCountDown - 1 > -1) {
            setTokenApproveResponseCountDown(tokenApproveResponseCountDown - 1)
          }
        }, 1000)
        return () => clearInterval(interval)
      }
    }
  }, [tokenApproveResponseCountDown])

  useEffect(() => {
    if (['success'].includes(tokenApproveResponse?.status)) {
      if (!tokenApproveResponseCountDown) {
        setTokenApproveResponseCountDown(approve_response_countdown_second)
      }
    }
  }, [tokenApproveResponse])
  // approve

  const isSupport = () => {
    const fromAsset = assets_data?.find(_asset => _asset?.id === swapConfig.fromAssetId)
    const toAsset = assets_data?.find(_asset => _asset?.id === swapConfig.toAssetId)

    const support = fromAsset && !(swapConfig.fromChainId && !fromAsset.contracts?.map(_contract => _contract?.chain_id)?.includes(swapConfig.fromChainId)) &&
      toAsset && !(swapConfig.toChainId && !toAsset.contracts?.map(_contract => _contract?.chain_id)?.includes(swapConfig.toChainId))

    return support
  }

  const getChainSynced = _chain_id => !chains_status_data || chains_status_data.find(_chain => _chain.chain_id === _chain_id)?.synced

  const getDeployedPriceOracleContract = _chain_id => {
    const record = contractDeployments?.[_chain_id?.toString()] || {}
    const name = Object.keys(record)[0]

    if (!name) {
      return undefined
    }

    const contract = record[name]?.contracts?.ConnextPriceOracle

    return contract
  }

  const getDeployedMulticallContract = _chain_id => {
    const record = contractDeployments?.[_chain_id?.toString()] || {}
    const name = Object.keys(record)[0]

    if (!name) {
      return undefined
    }

    const contract = record[name]?.contracts?.Multicall

    return contract
  }

  const getChainBalancesMulticall = async (_chain_id, _contracts) => {
    // const priceOracleContract = getDeployedPriceOracleContract(_chain_id)
    const calls = _contracts.map(_contract => {
      // return {
      //   address: priceOracleContract?.address,
      //   name: 'getTokenPrice',
      //   params: [_contract],
      // }
      return {
        address: _contract,
        name: 'balanceOf',
        params: [address],
      }
    })
    const multicallAddress = getDeployedMulticallContract(_chain_id)?.address
    const rpcUrls = chains_data?.filter(_chain => _chain?.chain_id === _chain_id).flatMap(_chain => _chain?.provider_params?.flatMap(_param => _param?.rpcUrls || [])) || []
    const rpcUrl = rpcUrls[Math.floor(Math.random() * (rpcUrls.length - 1))]

    // return await multicall(priceOracleContract.abi, calls, multicallAddress, rpcUrl)
    return await multicall(ERC20.abi, calls, multicallAddress, rpcUrl)
  }

  const getChainTokenMulticall = async (_chain_id, _contracts, _assets) => {
    if (_chain_id && _contracts) {
      let balances = await getChainBalancesMulticall(_chain_id, _contracts?.map(_contract => _contract?.contracts?.contract_address))

      if (balances) {
        const assets = []

        for (let i = 0; i < balances.length; i ++) {
          const balance = balances[i]?.toString()
          const _contract = _contracts[i]

          if (_contract) {
            const _balance = BigNumber(balance).shiftedBy(-_contract.contracts?.contract_decimals).toNumber()

            let _asset = _assets?.find(_asset => _asset?.contract_address === _contract.contracts?.contract_address || (_contract.contracts?.contract_address === constants.AddressZero && _contract.symbol?.toLowerCase() === _asset?.contract_ticker_symbol?.toLowerCase()))

            if (_asset) {
              _asset = {
                ..._asset,
                balance,
                quote: (_asset.quote_rate || 0) * _balance,
              }
            }
            else {
              _asset = {
                ..._contract.contracts,
                contract_ticker_symbol: _contract.symbol,
                balance,
              }
            }

            assets.push(_asset)
          }
        }

        dispatch({
          type: BALANCES_DATA,
          value: { [`${_chain_id}`]: assets },
        })
      }
    }
  }

  const getChainBalanceRPC = async (_chain_id, contract_address) => {
    let balance

    if (_chain_id && address && rpcs_data?.[_chain_id]) {
      const provider = rpcs_data?.[_chain_id]

      if (contract_address === constants.AddressZero) {
        balance = await provider.getBalance(address)
      }
      else {
        const contract = new Contract(contract_address, ['function balanceOf(address owner) view returns (uint256)'], provider)
        balance = await contract.balanceOf(address)
      }
    }

    return balance
  }

  const getChainTokenRPC = async (_chain_id, _contract, _asset) => {
    if (_chain_id && _contract) {
      let balance = await getChainBalanceRPC(_chain_id, _contract.contracts?.contract_address)

      if (balance) {
        balance = balance.toString()
        const _balance = BigNumber(balance).shiftedBy(-_contract.contracts?.contract_decimals).toNumber()

        if (_asset) {
          _asset = {
            ..._asset,
            balance,
            quote: (_asset.quote_rate || 0) * _balance,
          }
        }
        else {
          _asset = {
            ..._contract.contracts,
            contract_ticker_symbol: _contract.symbol,
            balance,
          }
        }

        dispatch({
          type: BALANCES_DATA,
          value: { [`${_chain_id}`]: [_asset] },
        })
      }
    }
  }

  const getChainBalances = async _chain_id => {
    if (_chain_id && address) {
      const _contracts = assets_data?.map(_asset => { return { ..._asset, contracts: _asset?.contracts?.find(_contract => _contract.chain_id === _chain_id) } }).filter(_asset => _asset?.contracts?.contract_address) || []

      const multicallAddress = getDeployedMulticallContract(_chain_id)?.address
      const hasAddressZero = _contracts.findIndex(_contract => _contract?.contracts?.contract_address === constants.AddressZero) > -1

      if (!balances_data?.[_chain_id]) {
        if (multicallAddress) {
          getChainTokenMulticall(_chain_id, _contracts?.filter(_contract => _contract?.contracts?.contract_address !== constants.AddressZero))

          if (hasAddressZero) {
            const _contract = _contracts?.find(_contract => _contract?.contracts?.contract_address === constants.AddressZero)

            getChainTokenRPC(_chain_id, _contract)
          }
        }
        else {
          for (let i = 0; i < _contracts.length; i++) {
            const _contract = _contracts[i]

            getChainTokenRPC(_chain_id, _contract)
          }
        }
      }

      const response = await getBalances(_chain_id, address)

      if (response?.data?.items) {
        const _assets = response?.data?.items.filter(_item => _item.contract_decimals)

        dispatch({
          type: BALANCES_DATA,
          value: { [`${_chain_id}`]: _assets },
        })

        if (multicallAddress) {
          getChainTokenMulticall(_chain_id, _contracts?.filter(_contract => _contract?.contracts?.contract_address !== constants.AddressZero), _assets)

          if (hasAddressZero) {
            const _contract = _contracts?.find(_contract => _contract?.contracts?.contract_address === constants.AddressZero)

            getChainTokenRPC(_chain_id, _contract, _assets.find(_asset => _contract.contracts.contract_address === constants.AddressZero && _contract.symbol?.toLowerCase() === _asset?.contract_ticker_symbol?.toLowerCase()))
          }
        }
        else {
          for (let i = 0; i < _contracts.length; i++) {
            const _contract = _contracts[i]

            getChainTokenRPC(_chain_id, _contract, _assets.find(_asset => _asset?.contract_address === _contract.contracts.contract_address || (_contract.contracts.contract_address === constants.AddressZero && _contract.symbol?.toLowerCase() === _asset?.contract_ticker_symbol?.toLowerCase())))
          }
        }
      }
      else if (balances_data?.[_chain_id] && balances_data?.[_chain_id]?.length < 1) {
        if (multicallAddress) {
          getChainTokenMulticall(_chain_id, _contracts?.filter(_contract => _contract?.contracts?.contract_address !== constants.AddressZero))

          if (hasAddressZero) {
            const _contract = _contracts?.find(_contract => _contract?.contracts?.contract_address === constants.AddressZero)

            getChainTokenRPC(_chain_id, _contract)
          }
        }
        else {
          for (let i = 0; i < _contracts.length; i++) {
            const _contract = _contracts[i]

            getChainTokenRPC(_chain_id, _contract)
          }
        }
      }
    }
  }

  const getChainBalance = (_chain_id, side = 'from') => {
    const chain = chains_data?.find(_chain => _chain?.chain_id === _chain_id)
    const asset = assets_data?.find(_asset => _asset?.id === swapConfig[`${side}AssetId`])

    let balance = balances_data?.[_chain_id]?.find(_contract => _contract?.contract_address === asset?.contracts?.find(__contract => __contract?.chain_id === _chain_id)?.contract_address)
    balance = balance || balances_data?.[_chain_id]?.find(_contract => asset?.symbol?.toLowerCase() === _contract?.contract_ticker_symbol?.toLowerCase() && chain?.provider_params?.[0]?.nativeCurrency?.symbol?.toLowerCase() === _contract?.contract_ticker_symbol?.toLowerCase())

    return balance
  }

  const getTokenPrice = async (_chain_id, contract_address) => {
    if (_chain_id && contract_address) {
      const key = `${_chain_id}_${contract_address}`

      if (!tokens_data?.[key]) {
        const response = await getContracts(_chain_id, contract_address)

        if (typeof response?.data?.[0]?.prices?.[0]?.price === 'number') {
          dispatch({
            type: TOKENS_DATA,
            value: { [`${key}`]: response.data[0] }, 
          })
        }
      }
    }
  }

  const getChainAssets = async (_chain_id, chainsConfig) => {
    if (_chain_id && chains_data) {
      const key = _chain_id

      const response = await assetBalances({ chain_id: chains_data?.find(_chain => _chain.chain_id === _chain_id)?.id })

      let routerStatus

      if (key === chainsConfig?.toChainId && chainsConfig?.fromChainId && sdk_data) {
        const routerStatusResponse = await sdk_data.getRouterStatus(process.env.NEXT_PUBLIC_APP_NAME)

        if (routerStatusResponse) {
          routerStatus = routerStatusResponse.filter(_router => _router?.supportedChains?.findIndex(chain_id => chain_id && chains_data?.findIndex(_chain => _chain?.chain_id === chain_id) > -1) > -1).map(_router => { return { ..._router, routerAddress: _router.routerAddress?.toLowerCase() } })
        }
      }

      if (response?.data) {
        dispatch({
          type: MAX_TRANSFERS_DATA,
          value: { [`${key}`]: Object.fromEntries(Object.entries(_.groupBy(response.data.filter(_asset => _asset?.assetId && _asset?.amount && Number(_asset.amount) > 0 && (!routerStatus || !chainsConfig || routerStatus.findIndex(_router => _router.routerAddress === _asset.router?.id && _router.supportedChains?.includes(chainsConfig.fromChainId) && _router.supportedChains?.includes(chainsConfig.toChainId)) > -1)), 'assetId')).map(([key, value]) => [key, _.maxBy(value?.map(_asset => { return { ..._asset, amount: Number(_asset?.amount) } }) || [], 'amount')])) }, 
        })
      }
    }
  }

  const getDomain = async address => {
    if (address && !ens_data?.[address.toLowerCase()]) {
      const response = await domains({ where: `{ resolvedAddress_in: ["${address.toLowerCase()}"] }` })

      if (response?.data) {
        dispatch({
          type: ENS_DATA,
          value: Object.fromEntries(response.data.map(domain => [domain?.resolvedAddress?.id?.toLowerCase(), { ...domain }])),
        })
      }
    }
  }

  const isTokenApproved = async isAfterApprove => {
    let approved = false

    if (address && chain_id/* && chain_id === swapConfig.fromChainId*/ && swapConfig.fromAssetId/* && typeof swapConfig.amount === 'number'*/ && (isAfterApprove || !tokenApproveResponse)) {
      const fromChainSynced = getChainSynced(swapConfig.fromChainId)
      const toChainSynced = getChainSynced(swapConfig.toChainId)

      if (isSupport()/* && fromChainSynced && toChainSynced*/) {
        const asset = assets_data?.find(_asset => _asset?.id === swapConfig.fromAssetId)
        const contract = asset.contracts?.find(_contract => _contract?.chain_id === swapConfig.fromChainId)

        if (contract?.contract_address) {
          if (contract.contract_address !== constants.AddressZero) {
            approved = await getApproved(signer, contract.contract_address, getDeployedTransactionManagerContract(swapConfig.fromChainId)?.address)
            // approved = approved.gte(BigNumber(swapConfig.amount).shiftedBy(contract?.contract_decimals))
          }
          else {
            approved = true
          }
        }
      }
    }

    return approved
  }

  const approveToken = async () => {
    const asset = assets_data?.find(_asset => _asset?.id === swapConfig.fromAssetId)
    const contract = asset.contracts?.find(_contract => _contract?.chain_id === swapConfig.fromChainId)

    setTokenApproveResponse(null)

    try {
      const tx_approve = await approve(signer, contract?.contract_address, getDeployedTransactionManagerContract(swapConfig.fromChainId)?.address, infiniteApproval ? constants.MaxUint256 : BigNumber(swapConfig.amount).shiftedBy(contract?.contract_decimals).toString())

      const tx_hash = tx_approve?.hash

      setTokenApproveResponse({ status: 'pending', message: `Wait for ${asset?.symbol} Approval Confirmation`, tx_hash })

      await tx_approve.wait()

      const _approved = await isTokenApproved(true)
      setTokenApproved(_approved)

      setTokenApproveResponse({ status: 'success', message: `${asset?.symbol} Approval Transaction Confirmed.`, tx_hash })
    } catch (error) {
      setTokenApproveResponse({ status: 'failed', message: error?.data?.message || error?.message })
    }
  }

  const isBreakAll = async message => ['code=', ' 0x'].findIndex(pattern => message?.includes(pattern)) > -1

  const estimate = async controller => {
    if (isSupport() && !swapData) {
      const fromAsset = swapConfig.fromChainId && swapConfig.fromAssetId && assets_data?.find(_asset => _asset?.id === swapConfig.fromAssetId && _asset.contracts?.findIndex(_contract => _contract?.chain_id === swapConfig.fromChainId) > -1)
      const toAsset = swapConfig.toChainId && swapConfig.toAssetId && assets_data?.find(_asset => _asset?.id === swapConfig.toAssetId && _asset.contracts?.findIndex(_contract => _contract?.chain_id === swapConfig.toChainId) > -1)

      const fromContract = fromAsset?.contracts?.find(_contract => _contract?.chain_id === swapConfig.fromChainId)
      const toContract = toAsset?.contracts?.find(_contract => _contract?.chain_id === swapConfig.toChainId)

      if (fromContract && toContract) {      
        setEstimatedAmountResponse(null)

        if (typeof swapConfig.amount === 'number') {
          setTokenApproveResponse(null)

          setFees(null)
          setEstimatingFees(false)

          setStartingSwap(false)
          setSwapData(null)
          setSwapResponse(null)

          if (sdk_data) {
            if (!controller.signal.aborted) {
              setEstimatingAmount(true)

              setBidExpiresSecond(bid_expires_second)
              setNumReceivedBid(0)

              try {
                const response = await sdk_data.getTransferQuote({
                  sendingChainId: swapConfig.fromChainId,
                  sendingAssetId: fromContract?.contract_address,
                  receivingChainId: swapConfig.toChainId,
                  receivingAssetId: toContract?.contract_address,
                  receivingAddress: advancedOptions?.receiving_address || address,
                  amount: BigNumber(swapConfig.amount).shiftedBy(fromContract?.contract_decimals).toString(),
                  transactionId: getRandomBytes32(),
                  expiry: moment().add(expiry_hours, 'hours').unix(),
                  callTo: advancedOptions?.contract_address || undefined,
                  callData: advancedOptions?.call_data || undefined,
                  initiator: undefined,
                  preferredRouters: advancedOptions?.preferredRouters?.split(',') || undefined,
                  dryRun: false,
                })

                if (!controller.signal.aborted) {
                  if (response?.bid?.sendingChainId === swapConfig.fromChainId && response?.bid?.receivingChainId === swapConfig.toChainId && response?.bid?.sendingAssetId === fromContract?.contract_address) {
                    getDomain(response?.bid?.router)
                    getDomain(address)
                    getDomain(advancedOptions?.receiving_address || address)

                    const gasFee = response?.gasFeeInReceivingToken && BigNumber(response.gasFeeInReceivingToken).shiftedBy(-toContract?.contract_decimals).toNumber()
                    const routerFee = response?.routerFee && BigNumber(response.routerFee).shiftedBy(-toContract?.contract_decimals).toNumber()
                    // const totalFee = response?.totalFee && BigNumber(response.totalFee).shiftedBy(-toContract?.contract_decimals).toNumber()
                    /* hotfix */
                    const totalFee = BigNumber(response.bid.amount).shiftedBy(-fromContract?.contract_decimals).toNumber() - BigNumber(response.bid.amountReceived).shiftedBy(-toContract?.contract_decimals).toNumber() + BigNumber(response?.metaTxRelayerFee || '0').shiftedBy(-toContract?.contract_decimals).toNumber()
                    // let routerFee

                    // if (response?.bid) {
                    //   if (swapConfig.fromAssetId === swapConfig.toAssetId) {
                    //     routerFee = swapConfig.amount - BigNumber(response.bid.amountReceived).shiftedBy(-toContract?.contract_decimals).toNumber() - gasFee
                    //   }
                    //   else {
                    //     if (typeof tokens_data?.[`${swapConfig.fromChainId}_${fromContract?.contract_address}`]?.prices?.[0]?.price === 'number' &&
                    //       typeof tokens_data?.[`${swapConfig.toChainId}_${toContract?.contract_address}`]?.prices?.[0]?.price === 'number'
                    //     ) {
                    //       const receivedAmount = BigNumber(response.bid.amountReceived).shiftedBy(-toContract?.contract_decimals).toNumber()

                    //       const fromPrice = tokens_data[`${swapConfig.fromChainId}_${fromContract?.contract_address}`].prices[0].price
                    //       const toPrice = tokens_data[`${swapConfig.toChainId}_${toContract?.contract_address}`].prices[0].price

                    //       const fromValue = swapConfig.amount * fromPrice
                    //       const toValue = receivedAmount * toPrice
                    //       const gasValue = gasFee * toPrice

                    //       routerFee = (fromValue - toValue - gasValue) / toPrice
                    //     }
                    //   }
                    // }

                    // setFees({
                    //   gas: gasFee,
                    //   relayer: BigNumber(response?.metaTxRelayerFee || '0').shiftedBy(-toContract?.contract_decimals).toNumber(),
                    //   router: routerFee,
                    //   total: totalFee,
                    // })
                    setFees({
                      relayer: BigNumber(response?.metaTxRelayerFee || '0').shiftedBy(-toContract?.contract_decimals).toNumber(),
                      gas: gasFee,
                      router: routerFee,
                      total: totalFee,
                    })

                    setEstimatedAmount(response)

                    setBidExpiresSecond(null)
                    setNumReceivedBid(null)
                  }
                }
              } catch (error) {
                if (!controller.signal.aborted) {
                  // if (error?.message?.includes('Error validating or retrieving bids for')) {
                  //   setEstimateTrigger(moment().valueOf())
                  // }
                  // else {
                    setEstimatedAmountResponse({ status: 'failed', message: error?.data?.message || error?.message })
                  // }
                }
              }

              if (!controller.signal.aborted) {
                setEstimatingAmount(false)
              }
            }
          }
        }
        else {
          setEstimatedAmount(null)
          setEstimatingAmount(false)

          if (!controller.signal.aborted) {
            setEstimatingFees(true)

            try {
              // const gasResponse = await sdk_data.estimateFeeForRouterTransferInReceivingToken(
              //   swapConfig.fromChainId,
              //   fromContract?.contract_address,
              //   swapConfig.toChainId,
              //   toContract?.contract_address,
              // )

              // const relayerResponse = await sdk_data.estimateMetaTxFeeInReceivingToken(
              //   swapConfig.fromChainId,
              //   fromContract?.contract_address,
              //   swapConfig.toChainId,
              //   toContract?.contract_address,
              // )

              // if (!controller.signal.aborted) {
              //   setFees({
              //     gas: gasResponse && BigNumber(gasResponse.toString()).shiftedBy(-toContract?.contract_decimals).toNumber(),
              //     relayer: relayerResponse && BigNumber(relayerResponse.toString()).shiftedBy(-toContract?.contract_decimals).toNumber(),
              //     router: null,
              //   })
              // }

              const response = await sdk_data.getEstimateReceiverAmount({
                amount: '0',
                sendingChainId: swapConfig.fromChainId,
                sendingAssetId: fromContract?.contract_address,
                receivingChainId: swapConfig.toChainId,
                receivingAssetId: toContract?.contract_address,
              })

              if (!controller.signal.aborted) {
                setFees({
                  relayer: BigNumber(response?.relayerFee || '0').shiftedBy(-toContract?.contract_decimals).toNumber(),
                  gas: BigNumber(response?.gasFee || '0').shiftedBy(-toContract?.contract_decimals).toNumber(),
                  router: BigNumber(response?.routerFee || '0').shiftedBy(-toContract?.contract_decimals).toNumber(),
                  total: BigNumber(response?.totalFee || '0').shiftedBy(-toContract?.contract_decimals).toNumber(),
                })
              }
            } catch (error) {
              if (!controller.signal.aborted) {
                setEstimatedAmountResponse({ status: 'failed', message: error?.data?.message || error?.message })
              }
            }

            if (!controller.signal.aborted) {
              setEstimatingFees(false)
            }
          }
        }

        getTokenPrice(swapConfig?.fromChainId, fromContract?.contract_address)
        getTokenPrice(swapConfig?.toChainId, toContract?.contract_address)

        const _approved = await isTokenApproved()
        setTokenApproved(_approved)
      }
    }
  }

  const swap = async () => {
    setStartingSwap(true)

    if (sdk_data) {
      try {
        const response = await sdk_data.prepareTransfer(estimatedAmount, infiniteApproval/*advancedOptions?.infinite_approval*/)

        setSwapData({ ...response, sendingChainId: estimatedAmount?.bid?.sendingChainId, receivingChainId: estimatedAmount?.bid?.receivingChainId })
        setSwapResponse(null)
      } catch (error) {
        setSwapResponse({ status: 'failed', message: error?.data?.message || error?.message })
      }

      const _approved = await isTokenApproved()
      setTokenApproved(_approved)
    }

    setStartingSwap(false)
  }

  const reset = async () => {
    setSwapConfig({ ...swapConfig, amount: null })
    setAdvancedOptions(defaultAdvancedOptions)

    setEstimateTrigger(null)

    setTokenApproved(null)
    setTokenApproveResponse(null)

    setFees(null)
    setEstimatingFees(null)
    setRefreshEstimatedFeesSecond(null)

    setEstimatedAmount(null)
    setEstimatingAmount(null)
    setEstimatedAmountResponse(null)
    setBidExpiresSecond(null)
    setNumReceivedBid(null)

    setStartingSwap(null)
    setSwapData(null)
    setSwapResponse(null)

    setActiveTransactionOpen(null)

    if (swapConfig?.fromChainId) {
      getChainBalances(swapConfig.fromChainId)
    }
    if (swapConfig?.toChainId) {
      getChainBalances(swapConfig.toChainId)
    }

    const _approved = await isTokenApproved()
    setTokenApproved(_approved)
  }

  const fromChain = chains_data?.find(_chain => _chain?.chain_id === swapConfig.fromChainId)
  const toChain = chains_data?.find(_chain => _chain?.chain_id === swapConfig.toChainId)

  const fromChainSynced = getChainSynced(swapConfig.fromChainId)
  const toChainSynced = getChainSynced(swapConfig.toChainId)
  const unsyncedChains = [!fromChainSynced && fromChain, !toChainSynced && toChain].filter(_chain => _chain)

  const fromAsset = assets_data?.find(_asset => _asset?.id === swapConfig.fromAssetId)
  const toAsset = assets_data?.find(_asset => _asset?.id === swapConfig.toAssetId)
  const fromContract = fromAsset?.contracts?.find(_contract => _contract?.chain_id === swapConfig.fromChainId)
  const toContract = toAsset?.contracts?.find(_contract => _contract?.chain_id === swapConfig.toChainId)

  const fromBalance = getChainBalance(swapConfig.fromChainId, 'from')
  const fromBalanceAmount = (fromBalance?.balance || 0) / Math.pow(10, fromBalance?.contract_decimals || 0)
  const toBalance = getChainBalance(swapConfig.toChainId, 'to')

  const confirmFromChain = chains_data?.find(_chain => _chain?.chain_id === estimatedAmount?.bid?.sendingChainId)
  const confirmToChain = chains_data?.find(_chain => _chain?.chain_id === estimatedAmount?.bid?.receivingChainId) 
  const confirmFromAsset = assets_data?.find(_asset => _asset?.contracts?.find(_contract => _contract.chain_id === estimatedAmount?.bid?.sendingChainId && _contract.contract_address?.toLowerCase() === estimatedAmount?.bid?.sendingAssetId?.toLowerCase()))
  const confirmToAsset = assets_data?.find(_asset => _asset?.contracts?.find(_contract => _contract.chain_id === estimatedAmount?.bid?.receivingChainId && _contract.contract_address?.toLowerCase() === estimatedAmount?.bid?.receivingAssetId?.toLowerCase()))
  const confirmFromContract = confirmFromAsset?.contracts?.find(_contract => _contract?.chain_id === estimatedAmount?.bid?.sendingChainId)
  const confirmToContract = confirmToAsset?.contracts?.find(_contract => _contract?.chain_id === estimatedAmount?.bid?.receivingChainId)
  const receivingAddress = estimatedAmount?.bid?.receivingAddress
  const confirmAmount = confirmFromContract && estimatedAmount?.bid?.amount && BigNumber(estimatedAmount.bid.amount).shiftedBy(-confirmFromContract?.contract_decimals).toNumber()
  const confirmRelayerFee = confirmToContract && estimatedAmount && BigNumber(estimatedAmount.metaTxRelayerFee || '0').shiftedBy(-confirmToContract?.contract_decimals).toNumber()
  const confirmGasFee = confirmToContract && estimatedAmount?.gasFeeInReceivingToken && BigNumber(estimatedAmount.gasFeeInReceivingToken).shiftedBy(-confirmToContract?.contract_decimals).toNumber()
  const confirmRouterFee = confirmToContract && estimatedAmount && BigNumber(estimatedAmount.routerFee || '0').shiftedBy(-confirmToContract?.contract_decimals).toNumber()
  const confirmAmountReceived = confirmToContract && estimatedAmount?.bid?.amountReceived && BigNumber(estimatedAmount.bid.amountReceived).shiftedBy(-confirmToContract?.contract_decimals).toNumber() - confirmRelayerFee
  // let confirmRouterFee
  // if (estimatedAmount?.bid) {
  //   if (confirmFromAsset.id === confirmToAsset.id) {
  //     confirmRouterFee = confirmAmount - confirmAmountReceived - confirmGasFee
  //   }
  //   else {
  //     if (typeof tokens_data?.[`${confirmFromChain?.chain_id}_${confirmFromContract?.contract_address}`]?.prices?.[0]?.price === 'number' &&
  //       typeof tokens_data?.[`${confirmToChain?.chain_id}_${confirmToContract?.contract_address}`]?.prices?.[0]?.price === 'number'
  //     ) {
  //       const fromPrice = tokens_data[`${confirmFromChain?.chain_id}_${confirmFromContract?.contract_address}`].prices[0].price
  //       const toPrice = tokens_data[`${confirmToChain?.chain_id}_${confirmToContract?.contract_address}`].prices[0].price

  //       const fromValue = confirmAmount * fromPrice
  //       const toValue = confirmAmountReceived * toPrice
  //       const gasValue = confirmGasFee * toPrice

  //       confirmRouterFee = (fromValue - toValue - gasValue) / toPrice
  //     }
  //   }
  // }
  // const confirmFees = estimatedAmount && ((confirmGasFee || 0) + (confirmRelayerFee || 0) + (confirmRouterFee || 0))
  /* hotfix */
  const confirmFees = confirmToContract && estimatedAmount && (confirmAmount - confirmAmountReceived)
  // const confirmFees = confirmToContract && estimatedAmount && BigNumber(estimatedAmount.totalFee || '0').shiftedBy(-confirmToContract?.contract_decimals).toNumber()

  let maxBalanceAmount = Number(fromBalance?.balance || 0) / Math.pow(10, fromBalance?.contract_decimals)
  maxBalanceAmount = maxBalanceAmount > smallNumber ? maxBalanceAmount : 0
  let maxTransfer = null
  let maxAmount = maxBalanceAmount
  if (swapConfig.fromAssetId && swapConfig.toAssetId) {
    const asset = max_transfers_data?.[swapConfig.toChainId]?.[toContract?.contract_address]

    if (asset) {
      maxTransfer = (asset.amount || 0) / Math.pow(10, toContract?.contract_decimals || 0)

      if (swapConfig.fromAssetId === swapConfig.toAssetId) {
        if (maxTransfer < maxAmount) {
          maxAmount = maxTransfer
        }
      }
      else {
        if (typeof tokens_data?.[`${swapConfig.fromChainId}_${fromContract?.contract_address}`]?.prices?.[0]?.price === 'number' &&
          typeof tokens_data?.[`${swapConfig.toChainId}_${toContract?.contract_address}`]?.prices?.[0]?.price === 'number'
        ) {
          const fromPrice = tokens_data[`${swapConfig.fromChainId}_${fromContract?.contract_address}`].prices[0].price
          const toPrice = tokens_data[`${swapConfig.toChainId}_${toContract?.contract_address}`].prices[0].price

          const fromValue = maxAmount * fromPrice
          const toValue = maxTransfer * toPrice

          if (toValue < fromValue) {
            maxAmount = toValue / fromPrice
          }
        }
      }
    }
  }
  maxAmount = maxAmount > smallNumber ? maxAmount : 0
  const isMaxLiquidity = maxAmount < maxBalanceAmount && typeof amount === 'number' && amount === maxAmount

  if (maxAmount > 0 && !isMaxLiquidity && typeof fromContract?.contract_decimals === 'number') {
    maxAmount = Math.floor(maxAmount * Math.pow(10, fromContract.contract_decimals)) / Math.pow(10, fromContract.contract_decimals)
  
    try {
      if (maxAmount) {
        let _maxAmount = maxAmount.toString()

        if (_maxAmount.includes('.') && _maxAmount.substring(_maxAmount.indexOf('.') + 1)?.length > 6) {
          _maxAmount = _maxAmount.substring(0, _maxAmount.indexOf('.') + 1 + 6)

          maxAmount = Number(_maxAmount)
        }
      }
    } catch (error) {}
  }

  const isNative = fromContract?.is_native

  const estimatedFees = typeof confirmFees === 'number' ? confirmFees : fees?.total//fees && ((fees.gas || 0) + (fees.relayer || 0) + (fees.router || 0))
  // hotfix
  const feesPopover = children => children || (
    <Popover
      placement="bottom"
      title={<div className="flex items-center space-x-2">
        <span className="whitespace-nowrap text-gray-600 dark:text-gray-400 text-sm font-semibold">{estimatedAmount ? '' : 'Estimated '}Fees:</span>
        <span className="text-black dark:text-white text-sm space-x-1">
          <span className="font-mono">{typeof estimatedFees === 'number' ? `${estimatedAmount ? '' : '~'}${numberFormat(estimatedFees, '0,0.00000000')}` : 'N/A'}</span>
          <span className="font-semibold">{(estimatedAmount ? confirmToAsset : toAsset)?.symbol}</span>
        </span>
      </div>}
      content={<div className="flex flex-col space-y-2">
        <div className="flex items-center justify-between space-x-2">
          <span className="whitespace-nowrap text-gray-400 dark:text-gray-600 text-xs font-medium">Dest. Tx Cost:</span>
          <span className="text-gray-600 dark:text-gray-400 text-xs space-x-1">
            <span className="font-mono">{typeof (estimatedAmount ? confirmRelayerFee : fees?.relayer) === 'number' ? `${estimatedAmount ? '' : '~'}${numberFormat(estimatedAmount ? confirmRelayerFee : fees.relayer, '0,0.00000000')}` : 'N/A'}</span>
            <span className="font-semibold">{(estimatedAmount ? confirmToAsset : toAsset)?.symbol}</span>
          </span>
        </div>
        <div className="flex items-center justify-between space-x-2">
          <span className="whitespace-nowrap text-gray-400 dark:text-gray-600 text-xs font-medium">Gas Fee:</span>
          <span className="text-gray-600 dark:text-gray-400 text-xs space-x-1">
            <span className="font-mono">{typeof (estimatedAmount ? confirmGasFee : fees?.gas) === 'number' ? `${estimatedAmount ? '' : '~'}${numberFormat(estimatedAmount ? confirmGasFee : fees.gas, '0,0.00000000')}` : 'N/A'}</span>
            <span className="font-semibold">{(estimatedAmount ? confirmToAsset : toAsset)?.symbol}</span>
          </span>
        </div>
        <div className="flex items-center justify-between space-x-2">
          <span className="whitespace-nowrap text-gray-400 dark:text-gray-600 text-xs font-medium">LP Fee:</span>
          <span className="text-gray-600 dark:text-gray-400 text-xs space-x-1">
            <span className="font-mono">{typeof (estimatedAmount ? confirmRouterFee : fees?.router) === 'number' ? `${estimatedAmount ? '' : '~'}${numberFormat(estimatedAmount ? confirmRouterFee : fees.router, '0,0.00000000')}` : `${process.env.NEXT_PUBLIC_ROUTER_FEE_PERCENT}%`}</span>
            <span className="font-semibold">{(estimatedAmount ? confirmToAsset : toAsset)?.symbol}</span>
          </span>
        </div>
      </div>}
    >
      {children}
    </Popover>
  )

  const mustChangeChain = swapConfig.fromChainId && chain_id !== swapConfig.fromChainId && !swapData && !activeTransactionOpen

  const mustApproveToken = isSupport() && fromContract && !(tokenApproved && (typeof tokenApproved === 'boolean' ? tokenApproved : tokenApproved.gte(BigNumber(swapConfig.amount).shiftedBy(fromContract?.contract_decimals))))

  const actionDisabled = tokenApproveResponse?.status === 'pending' || startingSwap

  const unlimitAllowance = tokenApproved === true || (tokenApproved && tokenApproved?.toNumber() >= constants.MaxUint256)
  const allowanceComponent = (
    <>
      <div className={`flex items-center ${unlimitAllowance ? 'text-gray-400 dark:text-gray-600' : ''} space-x-1.5`}>
        {infiniteApproval ?
          <BiInfinite size={16} />
          :
          <BiLock size={16} className="mb-0.5" />
        }
        <span className="font-medium">{infiniteApproval ? 'Infinite' : 'Exact'}</span>
      </div>
      <Switch
        disabled={actionDisabled || unlimitAllowance}
        checked={infiniteApproval}
        onChange={() => setInfiniteApproval(!infiniteApproval)}
        onColor="#6366F1"
        onHandleColor="#C7D2FE"
        offColor="#E5E7EB"
        offHandleColor="#F9FAFB"
        handleDiameter={24}
        uncheckedIcon={false}
        checkedIcon={false}
        boxShadow="0px 1px 5px rgba(0, 0, 0, 0.2)"
        activeBoxShadow="0px 1px 5px rgba(0, 0, 0, 0.2)"
        height={20}
        width={48}
        className="react-switch"
      />
    </>
  )

  return (
    <div className="grid grid-flow-row grid-cols-1 lg:grid-cols-8 items-start gap-4">
      <div className="hidden lg:block col-span-0 lg:col-span-2" />
      <div className="col-span-1 lg:col-span-4">
        <div className="space-y-4 px-0">
          {announcement_data?.data && (
            <Alert
              color="xl:max-w-lg bg-yellow-400 dark:bg-blue-600 text-left text-white mx-auto"
              icon={<HiSpeakerphone className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" />}
              closeDisabled={true}
              rounded={true}
              className="items-start"
            >
              <div className="block leading-4 text-xs xl:text-base font-medium">
                <span className="mr-2">
                  <Linkify>{parse(announcement_data?.data)}</Linkify>
                </span>
              </div>
            </Alert>
          )}
          {chains_status_data?.filter(_chain => !_chain.disabled && !_chain.synced).length > 0 && (
            <Alert
              color="xl:max-w-lg bg-yellow-400 dark:bg-blue-600 text-left text-white mx-auto"
              icon={<TiWarning className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" />}
              closeDisabled={true}
              rounded={true}
              className="items-start"
            >
              <div className="block font-mono leading-4 text-xs xl:text-base font-medium">
                <span className="mr-2">
                  Transfers to and from <span className="font-semibold">{chains_status_data?.filter(_chain => !_chain.disabled && !_chain.synced).map(_chain => _chain?.short_name).join(', ')}</span> may be delayed temporarily. Funds are always safe! If you have active transactions, check their status
                </span>
                <a
                  href={`${process.env.NEXT_PUBLIC_EXPLORER_URL}${address ? `/address/${address}` : ''}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-extrabold"
                >
                  {address ? 'here' : 'here'}
                </a>.
              </div>
            </Alert>
          )}
        </div>
        <div className="flex flex-col items-center justify-center space-y-2 sm:space-y-3 my-8 sm:my-12">
          <div className="w-full max-w-lg flex items-center justify-between space-x-2">
            <div className="flex items-center space-x-2">
              {/*<Img
                src="/logos/connext/logo.png"
                alt=""
                className="w-7 sm:w-8 h-7 sm:h-8 rounded-full"
              />*/}
              <h1 className="uppercase text-base sm:text-lg font-bold">Cross-Chain Swap</h1>
            </div>
            <div className="flex items-center space-x-2.5">
              {toChain && (
                <a
                  href={`${process.env.NEXT_PUBLIC_EXPLORER_URL}/${toChain.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-900 dark:hover:bg-gray-800 cursor-pointer rounded-xl capitalize flex items-center text-gray-700 dark:text-gray-300 text-base font-semibold py-2 px-3"
                >
                  {toChain?.image && (
                    <Img
                      src={toChain.image}
                      alt=""
                      className="w-5 h-5 rounded-full mr-1.5"
                    />
                  )}
                  <span>Liquidity</span>
                  <TiArrowRight size={20} className="transform -rotate-45 -mr-1" />
                </a>
              )}
            </div>
          </div>
          <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-lg py-6 px-6 sm:px-7">
            <div className="grid grid-flow-row grid-cols-1 sm:grid-cols-5 gap-4 sm:gap-6 mb-8 sm:mb-4">
              <div className="sm:col-span-2 flex flex-col items-center sm:items-start space-y-0">
                <span className="w-48 text-gray-400 dark:text-gray-500 text-base font-medium text-center sm:ml-0">From</span>
                <Network
                  from={swapConfig.fromChainId}
                  to={swapConfig.toChainId}
                  disabled={actionDisabled}
                  chain_id={swapConfig.fromChainId}
                  onSelect={_chain_id => {
                    const fromChainId = _chain_id
                    const toChainId = _chain_id === swapConfig.toChainId/* && swapConfig.fromAssetId && swapConfig.fromAssetId === swapConfig.toAssetId*/ ? swapConfig.fromChainId : swapConfig.toChainId

                    setSwapConfig({
                      ...swapConfig,
                      fromChainId,
                      toChainId,
                    })

                    if (_chain_id !== swapConfig.toChainId/* && swapConfig.fromAssetId*/) {
                      getChainBalances(_chain_id)
                    }

                    if (_chain_id === swapConfig.toChainId && swapConfig.fromAssetId && swapConfig.fromAssetId === swapConfig.toAssetId) {
                      getChainAssets(swapConfig.fromChainId, { fromChainId, toChainId })
                    }
                  }}
                />
                <Asset
                  from={swapConfig.fromAssetId}
                  to={swapConfig.toAssetId}
                  disabled={actionDisabled}
                  swapConfig={swapConfig}
                  onSelect={_asset_id => {
                    if (_asset_id !== swapConfig.fromAssetId) {
                      if (swapConfig.fromChainId) {
                        getChainBalances(swapConfig.fromChainId)
                      }
                      if (swapConfig.toChainId) {
                        getChainBalances(swapConfig.toChainId)
                      }
                    }

                    setSwapConfig({
                      ...swapConfig,
                      fromAssetId: _asset_id,
                      toAssetId: !swapConfig.toAssetId ?
                        swapConfig.fromChainId && swapConfig.fromChainId === swapConfig.toChainId ?
                          null
                          :
                          _asset_id
                          // null
                        :
                        swapConfig.fromChainId && swapConfig.fromChainId === swapConfig.toChainId && _asset_id === swapConfig.toAssetId ?
                          swapConfig.fromAssetId === _asset_id ?
                            null
                            :
                            swapConfig.fromAssetId
                          :
                          _asset_id,
                          // swapConfig.toAssetId,
                      amount: _asset_id !== swapConfig.fromAssetId && swapConfig.amount ? null : swapConfig.amount,
                    })
                  }}
                />
                <div className="w-48 flex items-center justify-center">
                  {!address ?
                    null
                    :
                    fromBalance ?
                      <div className="flex items-center text-gray-500 dark:text-gray-400 text-sm space-x-1.5">
                        <IoWallet size={20} />
                        <span className="font-mono">{numberFormat((fromBalance.balance || 0) / Math.pow(10, fromBalance.contract_decimals), '0,0.00000000')}</span>
                        <span className="font-semibold">{fromBalance.contract_ticker_symbol}</span>
                      </div>
                      :
                      !address || !fromAsset || !swapConfig.fromChainId ?
                        null
                        :
                        balances_data?.[swapConfig.fromChainId] ?
                          true || toBalance ?
                            <div className="text-gray-500 dark:text-gray-400 text-sm">-</div>
                            :
                            null
                          :
                          <Loader type="ThreeDots" color={theme === 'dark' ? '#F9FAFB' : '#D1D5DB'} width="16" height="16" />
                  }
                </div>
              </div>
              <div className="flex items-center justify-center">
                <button
                  disabled={actionDisabled}
                  onClick={() => {
                    const fromChainId = swapConfig.toChainId
                    const toChainId = swapConfig.fromChainId

                    setSwapConfig({
                      ...swapConfig,
                      fromChainId,
                      toChainId,
                      fromAssetId: swapConfig.toAssetId,
                      toAssetId: swapConfig.fromAssetId,
                      amount: null,
                    })

                    setInfiniteApproval(defaultInfiniteApproval)

                    if (swapConfig.fromChainId !== swapConfig.toChainId) {
                      getChainAssets(swapConfig.fromChainId, { fromChainId, toChainId })
                    }
                  }}
                  className={`${actionDisabled ? 'cursor-not-allowed' : ''}`}
                >
                  <MdSwapVerticalCircle size={40} className="sm:hidden rounded-full shadow-lg text-indigo-500 hover:text-indigo-600 dark:text-gray-200 dark:hover:text-white" />
                  <MdSwapHorizontalCircle size={40} className="hidden sm:block rounded-full shadow-lg text-indigo-500 hover:text-indigo-600 dark:text-gray-200 dark:hover:text-white" />
                </button>
              </div>
              <div className="sm:col-span-2 flex flex-col items-center sm:items-end space-y-0">
                <span className="w-48 text-gray-400 dark:text-gray-500 text-base font-medium text-center sm:mr-0">To</span>
                <Network
                  side="to"
                  from={swapConfig.fromChainId}
                  to={swapConfig.toChainId}
                  disabled={actionDisabled}
                  chain_id={swapConfig.toChainId}
                  onSelect={_chain_id => {
                    const fromChainId = _chain_id === swapConfig.fromChainId/* && swapConfig.fromAssetId && swapConfig.fromAssetId === swapConfig.toAssetId*/ ? swapConfig.toChainId : swapConfig.fromChainId
                    const toChainId = _chain_id

                    setSwapConfig({
                      ...swapConfig,
                      fromChainId,
                      toChainId: _chain_id,
                    })

                    if (_chain_id !== swapConfig.fromChainId && swapConfig.toAssetId) {
                      getChainBalances(_chain_id)
                    }

                    getChainAssets(_chain_id, { fromChainId, toChainId })
                  }}
                />
                <Asset
                  disabled={actionDisabled}
                  from={swapConfig.fromAssetId}
                  to={swapConfig.toAssetId}
                  swapConfig={swapConfig}
                  onSelect={_asset_id => {
                    if (_asset_id !== swapConfig.toAssetId) {
                      if (swapConfig.fromChainId) {
                        getChainBalances(swapConfig.fromChainId)
                      }
                      if (swapConfig.toChainId) {
                        getChainBalances(swapConfig.toChainId)
                      }
                    }

                    setSwapConfig({
                      ...swapConfig,
                      fromAssetId: !swapConfig.fromAssetId ?
                        swapConfig.fromChainId && swapConfig.fromChainId === swapConfig.toChainId ?
                          null
                          :
                          _asset_id
                          // null
                        :
                        swapConfig.fromChainId && swapConfig.fromChainId === swapConfig.toChainId && _asset_id === swapConfig.fromAssetId ?
                          swapConfig.toAssetId === _asset_id ?
                            null
                            :
                            swapConfig.toAssetId
                          :
                          _asset_id,
                          // swapConfig.fromAssetId,
                      toAssetId: _asset_id,
                      amount: !swapConfig.fromAssetId && _asset_id !== swapConfig.toAssetId && swapConfig.amount ? null : swapConfig.amount,
                    })
                  }}
                  side="to"
                />
                <div className="w-48 flex items-center justify-center">
                  {!address ?
                    null
                    :
                    toBalance ?
                      <div className="flex items-center text-gray-500 dark:text-gray-400 text-sm space-x-1.5">
                        <IoWallet size={20} />
                        <span className="font-mono">{numberFormat((toBalance.balance || 0) / Math.pow(10, toBalance.contract_decimals), '0,0.00000000')}</span>
                        <span className="font-semibold">{toBalance.contract_ticker_symbol}</span>
                      </div>
                      :
                      !toAsset || !swapConfig.toChainId ?
                        null
                        :
                        balances_data?.[swapConfig.toChainId] ?
                          true || fromBalance ?
                            <div className="text-gray-500 dark:text-gray-400 text-sm">-</div>
                            :
                            null
                          :
                          <Loader type="ThreeDots" color={theme === 'dark' ? '#F9FAFB' : '#D1D5DB'} width="16" height="16" />
                  }
                </div>
              </div>
            </div>
            {swapConfig.fromAssetId && (
              <div className="grid grid-flow-row grid-cols-1 sm:grid-cols-5 sm:gap-4 mb-8 sm:mb-4">
                <div className="order-1 sm:col-span-2 flex items-center justify-center sm:justify-start space-x-2">
                  <span className="text-gray-400 dark:text-gray-600 text-xl">Amount</span>
                  {fromAsset && swapConfig.fromAssetId !== swapConfig.toAssetId && (
                    <span className="text-gray-400 dark:text-gray-600 text-xl font-medium">{fromAsset.symbol}</span>
                  )}
                </div>
                <div className="order-2 sm:col-span-3 flex flex-col items-center sm:items-end space-y-0">
                  <Asset
                    disabled={actionDisabled}
                    swapConfig={swapConfig}
                    amountOnChange={_amount => {
                      setSwapConfig({
                        ...swapConfig,
                        amount: _amount && !isNaN(_amount) ? Number(_amount) : _amount,
                      })
                    }}
                  />
                </div>
                {address && isSupport() && (
                  <>
                    <div className={`${typeof maxTransfer === 'number' ? 'mt-2' : 'hidden mt-8'} sm:block order-4 sm:order-3 sm:col-span-2 sm:-mt-5 pt-0 sm:pt-2`}>
                      {typeof maxTransfer === 'number' && (
                        <div className="h-4 flex items-center justify-center sm:justify-start text-gray-400 dark:text-gray-500 text-2xs space-x-1.5 mx-auto">
                          <span className="whitespace-nowrap">Max Transfer:</span>
                          <span className="flex items-center text-2xs space-x-1">
                            <span className="font-mono">{numberFormat(maxTransfer, '0,0.000000')}</span>
                            <span className="font-medium">{toAsset?.symbol}</span>
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="w-48 sm:w-full order-3 sm:order-4 sm:col-span-3 -mt-1.5 sm:-mt-5 mx-auto pt-3 sm:pt-2">
                      <div className="w-full h-4 flex items-center justify-end mx-auto">
                        {isNative ?
                          null
                          :
                          balances_data?.[swapConfig.fromChainId] ?
                            <button
                              onClick={() => {
                                setSwapConfig({
                                  ...swapConfig,
                                  amount: maxAmount,
                                })
                              }}
                              className={`text-gray-800 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100 text-sm font-bold space-x-1 mr-${isMaxLiquidity ? 0 : '4 pr-0.5'}`}
                            >
                              <span>Max</span>
                              {isMaxLiquidity && (
                                <span className="text-gray-400 dark:text-gray-500 text-xs font-normal">(available liquidity)</span>
                              )}
                            </button>
                            :
                            <Loader type="ThreeDots" color={theme === 'dark' ? '#F9FAFB' : '#D1D5DB'} width="16" height="16" className="mr-4 pr-0.5" />
                        }
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            {isSupport() && web3_provider && (estimatingAmount || estimatingFees || typeof estimatedFees === 'number') && (
              <div className="grid grid-flow-row grid-cols-1 sm:grid-cols-5 sm:gap-4 mb-8 sm:mb-4 pb-0.5">
                <div className="sm:col-span-2 flex items-start justify-center sm:justify-start space-x-1">
                  <span className="text-gray-400 dark:text-gray-600 text-base">{estimatedAmount || estimatingAmount ? '' : 'Estimated '}Fees</span>
                  {/* hotfix *//*!(estimatedAmountResponse || estimatingAmount || estimatingFees || typeof estimatedFees !== 'number') && (
                    feesPopover(
                      <div className="text-gray-400 dark:text-gray-600 sm:mt-1">
                        <IoMdInformationCircle size={16} />
                      </div>
                    )
                  )*/}
                </div>
                <div className="sm:col-span-3 flex items-center justify-center sm:justify-end sm:mr-1">
                  {estimatingAmount || estimatingFees || typeof estimatedFees !== 'number' ?
                    <div className="flex items-center space-x-1.5">
                      <span className="text-gray-400 dark:text-gray-600 text-sm">{estimatedAmount || estimatingAmount ? 'Calculating' : 'Estimating'}</span>
                      <Loader type="BallTriangle" color={theme === 'dark' ? '#F9FAFB' : '#9CA3AF'} width="20" height="20" />
                    </div>
                    :
                    !estimatedAmountResponse && typeof estimatedFees === 'number' ?
                      <div className="flex flex-col items-center sm:items-end space-y-1">
                        {feesPopover(
                          <span className="flex items-center text-gray-500 dark:text-gray-200 text-sm space-x-1">
                            <span className="font-mono">{typeof estimatedFees === 'number' ? `${estimatedAmount ? '' : '~'}${numberFormat(estimatedFees, '0,0.000000')}` : 'N/A'}</span>
                            <span className="font-semibold">{toAsset?.symbol}</span>
                            {!estimatedAmount && (
                              <span className="font-mono lowercase text-gray-400 dark:text-gray-600">({refreshEstimatedFeesSecond}s)</span>
                            )}
                          </span>
                        )}
                        {typeof estimatedFees === 'number' && typeof tokens_data?.[`${fromChain?.chain_id}_${fromContract?.contract_address}`]?.prices?.[0]?.price === 'number' && (
                          <div className="font-mono text-gray-400 dark:text-gray-500 text-2xs sm:text-right">
                            ({currency_symbol}{numberFormat(estimatedFees * tokens_data[`${fromChain?.chain_id}_${fromContract?.contract_address}`].prices[0].price, '0,0.00000000')})
                          </div>
                        )}
                      </div>
                      :
                      <div className="text-gray-400 dark:text-gray-600 text-sm">-</div>
                  }
                </div>
              </div>
            )}
            {isSupport() && web3_provider && typeof swapConfig.amount === 'number' && (
              <div className="grid grid-flow-row grid-cols-1 sm:grid-cols-5 sm:gap-4 mb-8 sm:mb-4 pb-0.5">
                <div className="min-w-max order-1 sm:col-span-2 flex justify-center sm:justify-start">
                  <span className="text-gray-400 dark:text-gray-600 text-xl mr-2">Estimated Received</span>
                  {!swapData && !swapResponse && estimatedAmount && !estimatingAmount && (
                    <button
                      onClick={() => setEstimateTrigger(moment().valueOf())}
                      className="h-7 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 flex items-center justify-center text-indigo-400 hover:text-indigo-600 dark:text-gray-200 dark:hover:text-white rounded-full p-1.5 z-10"
                    >
                      <MdRefresh size={16} />
                    </button>
                  )}
                </div>
                <div className="order-2 sm:col-span-3 flex flex-col items-center sm:items-end space-y-0 my-0.5 sm:mr-1">
                  <div className="h-10 sm:h-7 flex items-center justify-center sm:justify-start space-x-2">
                    <div className="sm:w-48 font-mono flex items-center justify-end text-lg text-right sm:px-1">
                      {estimatingAmount ?
                        <Loader type="ThreeDots" color={theme === 'dark' ? '#F9FAFB' : '#D1D5DB'} width="24" height="24" className="mt-1.5" />
                        :
                        !estimatedAmountResponse && estimatedAmount ?
                          <span className="font-semibold">
                            {numberFormat(confirmAmountReceived, '0,0.00000000', true)}
                          </span>
                          :
                          <span className="text-gray-400 dark:text-gray-500">-</span>
                      }
                    </div>
                    <span className="text-lg font-semibold">{confirmToAsset?.symbol || toAsset?.symbol}</span>
                  </div>
                  {!estimatedAmountResponse && !estimatingAmount && estimatedAmount && typeof tokens_data?.[`${confirmToChain.chain_id}_${confirmToContract?.contract_address}`]?.prices?.[0]?.price === 'number' && (
                    <div className="font-mono text-gray-400 dark:text-gray-500 text-xs">
                      ({currency_symbol}{numberFormat(confirmAmountReceived * tokens_data[`${confirmToChain.chain_id}_${confirmToContract?.contract_address}`].prices[0].price, '0,0.00000000')})
                    </div>
                  )}
                </div>
              </div>
            )}
            {swapConfig.fromAssetId && fromContract?.contract_address !== constants.AddressZero && typeof swapConfig.amount === 'number' && (
              <div className="grid grid-flow-row grid-cols-2 sm:grid-cols-5 sm:gap-4 mb-4 sm:mb-2 pb-0.5">
                <div className="sm:col-span-2 flex items-center justify-start space-x-1">
                  <span className="text-gray-400 dark:text-gray-600 text-base">Allowance</span>
                  <Popover
                    placement="bottom"
                    title="Allowance"
                    content={<div className="w-72">
                      Only the exact amount is allowed to be transferred. You will need to reapprove for a subsequent transaction.
                    </div>}
                  >
                    <span className="text-gray-400 dark:text-gray-600">
                      <BsFillQuestionCircleFill size={14} />
                    </span>
                  </Popover>
                </div>
                <div className="sm:col-span-3 flex items-center justify-end space-x-2">
                  {unlimitAllowance ?
                    <Popover
                      placement="top"
                      title={`${fromAsset?.symbol} Allowance`}
                      content={<div className="w-36">Infinite allowance on</div>}
                    >
                      <div className="flex items-center justify-end capitalize space-x-2">
                        {allowanceComponent}
                      </div>
                    </Popover>
                    :
                    allowanceComponent
                  }
                </div>
              </div>
            )}
            <div className="grid grid-flow-row grid-cols-1 sm:gap-4 mb-8 sm:mb-4">
              <AdvancedOptions
                applied={!_.isEqual(advancedOptions, defaultAdvancedOptions)}
                disabled={['pending'].includes(tokenApproveResponse?.status)}
                initialOptions={advancedOptions}
                updateOptions={_options => setAdvancedOptions(_options)}
              />
            </div>
            {isSupport() && (swapData || balances_data?.[swapConfig.fromChainId])/* && typeof estimatedFees === 'number'*/ && (typeof swapConfig.amount === 'number' || (mustChangeChain && web3_provider)) ?
              !estimatedAmountResponse && mustChangeChain ?
                <div className="sm:pt-1.5 pb-1">
                  <Wallet
                    chainIdToConnect={swapConfig.fromChainId}
                    buttonDisconnectTitle={<>
                      <span>Switch to</span>
                      <Img
                        src={fromChain?.image}
                        alt=""
                        className="w-8 h-8 rounded-full"
                      />
                      <span className="font-semibold">{fromChain?.title}</span>
                    </>}
                    buttonDisconnectClassName="w-full bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800 rounded-lg shadow-lg flex items-center justify-center text-gray-100 hover:text-white text-sm sm:text-base space-x-2 py-4 px-3"
                  />
                </div>
                :
                !swapData && !estimatingFees && swapConfig.fromAssetId === swapConfig.toAssetId && swapConfig.amount < estimatedFees ?
                  <div className="sm:pt-1.5 pb-1">
                    <Alert
                      color="bg-red-400 dark:bg-red-500 text-left text-white"
                      icon={<BiMessageError className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" />}
                      closeDisabled={true}
                      rounded={true}
                    >
                      <span className="font-mono text-sm">You must send at least {numberFormat(estimatedFees, '0,0.000000')} {toAsset?.symbol} amount to cover fees.</span>
                    </Alert>
                  </div>
                  :
                  !swapData && !estimatedAmountResponse && check_balances && fromBalanceAmount < swapConfig.amount ?
                    <div className="sm:pt-1.5 pb-1">
                      <Alert
                        color="bg-red-400 dark:bg-red-500 text-left text-white"
                        icon={<BiMessageError className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" />}
                        closeDisabled={true}
                        rounded={true}
                      >
                        <span className="font-mono text-sm">Insufficient Funds</span>
                      </Alert>
                    </div>
                    :
                    !swapData && !(fromChainSynced && toChainSynced) ?
                      <div className="sm:pt-1.5 pb-1">
                        <Alert
                          color="bg-red-400 dark:bg-red-500 text-left text-white"
                          icon={<BiMessageError className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" />}
                          closeDisabled={true}
                          rounded={true}
                        >
                          <span className="font-mono text-sm">
                            {unsyncedChains.map((_chain, i) => (
                              <span key={i} className="inline-flex items-baseline mr-2">
                                {_chain.image && (
                                  <Img
                                    src={_chain.image}
                                    alt=""
                                    className="w-4 h-4 rounded-full self-center mr-1"
                                  />
                                )}
                                <span className="font-bold">{_chain.title}</span>
                                {i < unsyncedChains.length - 1 && (
                                  <span className="ml-1.5">&</span>
                                )}
                              </span>
                            ))}
                            <span>subgraph{unsyncedChains.length > 1 ? 's' : ''} is out of sync. Please try again later.</span>
                          </span>
                        </Alert>
                      </div>
                      :
                      activeTransactionOpen ?
                        null
                        :
                        !swapData && !swapResponse && !estimatedAmountResponse && (estimatedAmount || estimatingAmount) ?
                          <div className="sm:pt-1.5 pb-1">
                            {!estimatingAmount && estimatedAmount && estimatedFees > confirmAmountReceived && (
                              <div className="order-2 sm:col-span-5 flex flex-wrap items-center justify-center text-yellow-500 dark:text-yellow-400 mt-4 sm:mt-0 mb-2">
                                <TiWarning size={16} className="mb-0.5 mr-1.5" />
                                <span>Fee is greater than estimated received.</span>
                              </div>
                            )}
                            {estimatingAmount ?
                              <button
                                disabled={estimatingAmount}
                                className={`w-full ${estimatingAmount ? 'bg-blue-400 dark:bg-blue-500' : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800'} ${estimatingAmount ? 'cursor-not-allowed' : ''} rounded-lg shadow-lg flex flex-wrap items-center justify-center text-gray-100 hover:text-white text-base sm:text-lg space-x-2 py-4 px-3`}
                              >
                                {estimatingAmount ?
                                  <>
                                    <Loader type="Oval" color={theme === 'dark' ? '#FFFFFF' : '#F9FAFB'} width="24" height="24" />
                                    <span>Searching Routes</span>
                                  </>
                                  :
                                  <span>Swap</span>
                                }
                                {swapConfig.fromAssetId === swapConfig.toAssetId && (
                                  <span className="font-bold">{fromAsset?.symbol}</span>
                                )}
                                {estimatingAmount && typeof bidExpiresSecond === 'number' && (
                                  <span className="text-gray-200 dark:text-gray-100 text-sm font-medium mt-0.5">{numReceivedBid ? `- Received ${numReceivedBid} Bid${numReceivedBid > 1 ? 's' : ''}` : '- Next bid in'} ({bidExpiresSecond}s)</span>
                                )}
                              </button>
                              :
                              mustApproveToken ?
                                (typeof tokenApproved === 'boolean' || tokenApproved) && (
                                  <div className="sm:pt-1.5 pb-1">
                                    <button
                                      disabled={actionDisabled}
                                      onClick={() => approveToken()}
                                      className={`w-full ${actionDisabled ? 'bg-blue-400 dark:bg-blue-500' : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800'} ${actionDisabled ? 'cursor-not-allowed' : ''} rounded-lg shadow-lg flex items-center justify-center text-gray-100 hover:text-white text-base sm:text-lg space-x-2 py-4 px-3`}
                                    >
                                      {tokenApproveResponse?.status === 'pending' ?
                                        <>
                                          <Loader type="Oval" color={theme === 'dark' ? '#FFFFFF' : '#F9FAFB'} width="24" height="24" />
                                          <span>Approving</span>
                                        </>
                                        :
                                        <span>Approve</span>
                                      }
                                      <span className="font-semibold">{fromAsset?.symbol}</span>
                                    </button>
                                  </div>
                                )
                                :
                                <ModalConfirm
                                  buttonTitle={<>
                                    <span>Swap</span>
                                    <span className="font-bold">{fromAsset?.symbol}</span>
                                  </>}
                                  onClick={() => {
                                    setTokenApproveResponse(null)
                                    setConfirmFeesCollapsed(true)
                                  }}
                                  buttonClassName="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 rounded-lg shadow-lg flex items-center justify-center text-gray-100 hover:text-white text-base sm:text-lg space-x-2 py-4 px-3"
                                  title="Swap Confirmation"
                                  body={<div className="flex flex-col space-y-3 sm:space-y-4 mt-0.5 -mb-2">
                                    <div className="flex items-center space-x-8 mx-auto py-2">
                                      {confirmFromChain && (
                                        <div className="flex flex-col items-center space-y-1">
                                          <Img
                                            src={confirmFromChain.image}
                                            alt=""
                                            className="w-10 h-10 rounded-full"
                                          />
                                          <span className="text-gray-600 dark:text-gray-400 text-xs font-semibold">
                                            {chainTitle(confirmFromChain)}
                                          </span>
                                        </div>
                                      )}
                                      {/*<TiArrowRight size={24} className="transform text-gray-400 dark:text-gray-500 -mt-4" />*/}
                                      <div className="flex flex-col items-center space-y-1">
                                        <Img
                                          src="/logos/connext/logo.png"
                                          alt=""
                                          className="w-10 h-10 rounded-full"
                                        />
                                        <div className="h-4" />
                                        {/*<div className="flex items-center space-x-1">
                                          <a
                                            href={`${process.env.NEXT_PUBLIC_EXPLORER_URL}/router/${estimatedAmount.bid?.router?.toLowerCase()}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-gray-900 dark:text-gray-100 text-xs font-semibold"
                                          >
                                            {ens_data?.[estimatedAmount.bid?.router?.toLowerCase()]?.name || ellipseAddress(estimatedAmount.bid?.router?.toLowerCase(), 5)}
                                          </a>
                                          <Copy size={14} text={estimatedAmount.bid?.router?.toLowerCase()} />
                                        </div>*/}
                                      </div>
                                      {/*<TiArrowRight size={24} className="transform text-gray-400 dark:text-gray-500 -mt-4" />*/}
                                      {confirmToChain && (
                                        <div className="flex flex-col items-center space-y-1">
                                          <img
                                            src={confirmToChain.image}
                                            alt=""
                                            className="w-10 h-10 rounded-full"
                                          />
                                          <span className="text-gray-600 dark:text-gray-400 text-xs font-semibold">
                                            {chainTitle(confirmToChain)}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-1 sm:space-y-0 sm:space-x-1 xl:space-x-2">
                                      <div className="flex items-center text-gray-400 dark:text-gray-500 text-lg md:text-sm lg:text-base">
                                        Receiving Address
                                        <span className="hidden sm:block">:</span>
                                      </div>
                                      {receivingAddress && (<div className="flex items-center space-x-1.5 sm:space-x-1 xl:space-x-1.5">
                                        {ens_data?.[receivingAddress?.toLowerCase()]?.name && (
                                          <Img
                                            src={`${process.env.NEXT_PUBLIC_ENS_AVATAR_URL}/${ens_data?.[receivingAddress.toLowerCase()].name}`}
                                            alt=""
                                            className="w-6 h-6 rounded-full"
                                          />
                                        )}
                                        <span className="text-gray-900 dark:text-gray-100 text-base sm:text-xs xl:text-base font-semibold">
                                          {ellipseAddress(ens_data?.[receivingAddress?.toLowerCase()]?.name, 10) || ellipseAddress(receivingAddress?.toLowerCase(), 10)}
                                        </span>
                                        <Copy size={18} text={receivingAddress} />
                                        {confirmToChain?.explorer?.url && (
                                          <a
                                            href={`${confirmToChain.explorer.url}${confirmToChain.explorer.address_path?.replace('{address}', receivingAddress)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 dark:text-white"
                                          >
                                            {confirmToChain.explorer.icon ?
                                              <Img
                                                src={confirmToChain.explorer.icon}
                                                alt=""
                                                className="w-5 sm:w-4 xl:w-5 h-5 sm:h-4 xl:h-5 rounded-full opacity-60 hover:opacity-100"
                                              />
                                              :
                                              <TiArrowRight size={20} className="transform -rotate-45" />
                                            }
                                          </a>
                                        )}
                                      </div>)}
                                    </div>
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-1 sm:space-y-0 sm:space-x-1 xl:space-x-2">
                                      <div className="flex items-center text-gray-400 dark:text-gray-500 text-lg md:text-sm lg:text-base">
                                        Router Address
                                        <span className="hidden sm:block">:</span>
                                      </div>
                                      <div className="flex items-center space-x-1.5 sm:space-x-1 xl:space-x-1.5">
                                        <span className="text-gray-900 dark:text-gray-100 text-base sm:text-xs xl:text-base font-semibold">
                                          {ens_data?.[estimatedAmount.bid?.router?.toLowerCase()]?.name || ellipseAddress(estimatedAmount.bid?.router?.toLowerCase(), 10)}
                                        </span>
                                        <Copy size={18} text={estimatedAmount.bid?.router?.toLowerCase()} />
                                        <a
                                          href={`${process.env.NEXT_PUBLIC_EXPLORER_URL}/router/${estimatedAmount.bid?.router?.toLowerCase()}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-600 dark:text-white"
                                        >
                                          <TiArrowRight size={20} className="transform -rotate-45" />
                                        </a>
                                      </div>
                                    </div>
                                    <div className="h-1 border-t border-gray-200 dark:border-gray-600" />
                                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between space-y-1 sm:space-y-0 sm:space-x-1 xl:space-x-2">
                                      <div className="flex items-center text-gray-400 dark:text-gray-500 text-lg md:text-sm lg:text-base">
                                        Send Amount
                                        <span className="hidden sm:block">:</span>
                                      </div>
                                      <div className="sm:text-right">
                                        <div className="text-lg space-x-1.5">
                                          <span className="font-mono font-semibold">{numberFormat(confirmAmount, '0,0.00000000', true)}</span>
                                          <span className="font-semibold">{confirmFromAsset?.symbol}</span>
                                        </div>
                                        {confirmAmount && typeof tokens_data?.[`${confirmFromChain?.chain_id}_${confirmFromContract?.contract_address}`]?.prices?.[0]?.price === 'number' && (
                                          <div className="font-mono text-gray-400 dark:text-gray-500 text-sm sm:text-right">
                                            ({currency_symbol}{numberFormat(confirmAmount * tokens_data[`${confirmFromChain?.chain_id}_${confirmFromContract?.contract_address}`].prices[0].price, '0,0.00000000')})
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between space-y-1 sm:space-y-0 sm:space-x-1 xl:space-x-2">
                                      <div className="flex items-center text-gray-400 dark:text-gray-500 text-lg md:text-sm lg:text-base">
                                        Fees
                                        {/*feesPopover(
                                          <IoMdInformationCircle size={16} className="text-gray-400 dark:text-gray-600 ml-1.5" />
                                        )*/}
                                        <span className="hidden sm:block">:</span>
                                      </div>
                                      <div className="flex items-center space-x-1.5">
                                        <div className="w-full">
                                          <button
                                            onClick={() => setConfirmFeesCollapsed(!confirmFeesCollapsed)}
                                            className="bg-transparent flex items-start text-sm space-x-1.5 sm:ml-auto"
                                          >
                                            {/* hotfix *//*confirmFeesCollapsed ?
                                              <BiChevronRight size={20} className="text-gray-400 dark:text-gray-500 mt-1" />
                                              :
                                              <BiChevronUp size={20} className="text-gray-400 dark:text-gray-500 mt-1" />
                                            */}
                                            <div className="text-lg space-x-1.5">
                                              <span className="font-mono font-semibold">{numberFormat(estimatedFees, '0,0.00000000')}</span>
                                              <span className="font-semibold">{confirmToAsset?.symbol}</span>
                                            </div>
                                          </button>
                                          {/* hotfix */false && !confirmFeesCollapsed && (
                                            <div className="flex flex-col items-start sm:items-end py-1.5">
                                              <div className="w-full grid grid-flow-row grid-cols-2 gap-1.5">
                                                <span className="flex items-center text-gray-400 dark:text-gray-500 text-sm mr-4">
                                                  Dest. Tx Cost
                                                  <Popover
                                                    placement="bottom"
                                                    title="Dest. Tx Cost"
                                                    content={<div className="w-60 text-gray-600 dark:text-gray-400 text-xs">
                                                      Fee for relayer to deliver funds to user on receiving chain.
                                                    </div>}
                                                  >
                                                    <IoMdInformationCircle size={16} className="text-gray-300 dark:text-gray-600 ml-1" />
                                                  </Popover>
                                                  :
                                                  </span>
                                                <div className="text-gray-400 dark:text-gray-500 text-sm text-right space-x-1.5">
                                                  <span className="font-mono">{numberFormat(confirmRelayerFee, '0,0.00000000')}</span>
                                                  <span>{confirmToAsset?.symbol}</span>
                                                </div>
                                                <span className="flex items-center text-gray-400 dark:text-gray-500 text-sm mr-4">
                                                  Gas Fee
                                                  <Popover
                                                    placement="bottom"
                                                    title="Gas Fee"
                                                    content={<div className="w-40 text-gray-600 dark:text-gray-400 text-xs">
                                                      Covers gas expense for router transactions on sending and receiving chains."
                                                    </div>}
                                                  >
                                                    <IoMdInformationCircle size={16} className="text-gray-300 dark:text-gray-600 ml-1" />
                                                  </Popover>
                                                  :
                                                </span>
                                                <div className="text-gray-400 dark:text-gray-500 text-sm text-right space-x-1.5">
                                                  <span className="font-mono">{numberFormat(confirmGasFee, '0,0.00000000')}</span>
                                                  <span>{confirmToAsset?.symbol}</span>
                                                </div>
                                                <span className="flex items-center text-gray-400 dark:text-gray-500 text-sm mr-4">
                                                  LP Fee
                                                  <Popover
                                                    placement="bottom"
                                                    title="LP Fee"
                                                    content={<div className="w-44 text-gray-600 dark:text-gray-400 text-xs">
                                                      Liquidity provider service fee.
                                                    </div>}
                                                  >
                                                    <IoMdInformationCircle size={16} className="text-gray-300 dark:text-gray-600 ml-1" />
                                                  </Popover>
                                                  :
                                                </span>
                                                <div className="text-gray-400 dark:text-gray-500 text-sm text-right space-x-1.5">
                                                  <span className="font-mono">{numberFormat(confirmRouterFee, '0,0.00000000')}</span>
                                                  <span>{confirmToAsset?.symbol}</span>
                                                </div>
                                                {/*<span className="text-gray-500 dark:text-gray-400 text-base">Total:</span>
                                                <div className="text-gray-800 dark:text-gray-200 text-base text-right space-x-1.5">
                                                  <span className="font-mono font-medium">{numberFormat(estimatedFees, '0,0.00000000')}</span>
                                                  <span className="font-medium">{confirmToAsset?.symbol}</span>
                                                </div>*/}
                                              </div>
                                            </div>
                                          )}
                                          {estimatedFees && typeof tokens_data?.[`${confirmToChain?.chain_id}_${confirmToContract?.contract_address}`]?.prices?.[0]?.price === 'number' && (
                                            <div className="font-mono text-gray-400 dark:text-gray-500 text-sm sm:text-right">
                                              ({currency_symbol}{numberFormat(estimatedFees * tokens_data[`${confirmToChain?.chain_id}_${confirmToContract?.contract_address}`].prices[0].price, '0,0.00000000')})
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    {/*<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-1 sm:space-y-0 sm:space-x-1 xl:space-x-2">
                                      <div className="flex items-center text-gray-400 dark:text-gray-500 text-lg md:text-sm lg:text-base">
                                        Slippage
                                        <span className="hidden sm:block">:</span>
                                      </div>
                                      <div className="text-gray-500 dark:text-gray-400 text-base space-x-1.5">
                                        <span className="font-mono font-medium">{estimatedAmount.bid?.slippage ? numberFormat(estimatedAmount.bid.slippage, '0,0.00000000') : 'N/A'}</span>
                                        <span className="font-medium">%</span>
                                      </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between space-y-1 sm:space-y-0 sm:space-x-1 xl:space-x-2">
                                      <div className="flex items-center text-gray-400 dark:text-gray-500 text-lg md:text-sm lg:text-base">
                                        Minimum Received
                                        <span className="hidden sm:block">:</span>
                                      </div>
                                      <div>
                                        <div className="text-gray-500 dark:text-gray-400 text-base space-x-1.5">
                                          <span className="font-mono font-medium">{estimatedAmount.bid?.minimumReceived ? numberFormat(BigNumber(estimatedAmount.bid?.minimumReceived).shiftedBy(-confirmToContract?.contract_decimals).toNumber(), '0,0.00000000') : 'N/A'}</span>
                                          <span className=" font-medium">{confirmToAsset?.symbol}</span>
                                        </div>
                                        {estimatedAmount.bid?.minimumReceived && typeof tokens_data?.[`${confirmToChain?.chain_id}_${confirmToContract?.contract_address}`]?.prices?.[0]?.price === 'number' && (
                                          <div className="font-mono text-gray-400 dark:text-gray-500 text-sm sm:text-right">
                                            ({currency_symbol}{numberFormat(BigNumber(estimatedAmount.bid?.minimumReceived).shiftedBy(-confirmToContract?.contract_decimals).toNumber() * tokens_data[`${confirmToChain?.chain_id}_${confirmToContract?.contract_address}`].prices[0].price, '0,0.00000000')})
                                          </div>
                                        )}
                                      </div>
                                    </div>*/}
                                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between space-y-1 sm:space-y-0 sm:space-x-1 xl:space-x-2">
                                      <div className="flex items-center text-gray-400 dark:text-gray-500 text-lg sm:text-sm lg:text-base">
                                        Estimated Received
                                        <span className="hidden sm:block">:</span>
                                      </div>
                                      <div className="sm:text-right">
                                        <div className="text-lg space-x-1.5">
                                          <span className="font-mono font-semibold">{numberFormat(confirmAmountReceived, '0,0.00000000', true)}</span>
                                          <span className="font-semibold">{confirmToAsset?.symbol}</span>
                                        </div>
                                        {confirmAmountReceived && typeof tokens_data?.[`${confirmToChain?.chain_id}_${confirmToContract?.contract_address}`]?.prices?.[0]?.price === 'number' && (
                                          <div className="font-mono text-gray-400 dark:text-gray-500 text-sm sm:text-right">
                                            ({currency_symbol}{numberFormat(confirmAmountReceived * tokens_data[`${confirmToChain?.chain_id}_${confirmToContract?.contract_address}`].prices[0].price, '0,0.00000000')})
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    {estimatedFees > confirmAmountReceived && (
                                      <div className="flex items-center text-base sm:text-lg font-medium pt-2">
                                        <TiWarning size={20} className="text-yellow-500 mr-1.5" />
                                        <span>Are you sure that you want to swap?</span>
                                      </div>
                                    )}
                                  </div>}
                                  cancelButtonTitle="Cancel"
                                  cancelDisabled={startingSwap}
                                  cancelButtonClassName="hidden"
                                  confirmButtonTitle={<span className="flex items-center justify-center space-x-1.5 py-2">
                                    {startingSwap && (
                                      <Loader type="Oval" color={theme === 'dark' ? '#FFFFFF' : '#F9FAFB'} width="20" height="20" />
                                    )}
                                    <span className="text-base">Confirm</span>
                                  </span>}
                                  confirmDisabled={startingSwap}
                                  onConfirmHide={false}
                                  onConfirm={() => swap()}
                                  confirmButtonClassName="w-full btn btn-default btn-rounded bg-blue-600 hover:bg-blue-500 justify-center text-white"
                                />
                            }
                          </div>
                          :
                          !swapData && estimatedAmountResponse ?
                            <div className="sm:pt-1.5 pb-1">
                              <Alert
                                color={`${estimatedAmountResponse.status === 'failed' ? 'bg-red-400 dark:bg-red-500' : estimatedAmountResponse.status === 'success' ? 'bg-green-400 dark:bg-green-500' : 'bg-blue-400 dark:bg-blue-500'} text-white`}
                                icon={estimatedAmountResponse.status === 'failed' ? <BiMessageError className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" /> : estimatedAmountResponse.status === 'success' ? <BiMessageCheck className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" /> : <BiMessageDetail className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" />}
                                closeDisabled={true}
                                rounded={true}
                              >
                                <div className="flex items-center justify-between space-x-1">
                                  <span className={`break-${isBreakAll(estimatedAmountResponse.message) ? 'all' : 'words'} font-mono text-sm`}>{estimatedAmountResponse.message}</span>
                                  <button
                                    onClick={() => setEstimateTrigger(moment().valueOf())}
                                    className="bg-red-500 dark:bg-red-400 flex items-center justify-center text-white rounded-full p-2"
                                  >
                                    <MdRefresh size={20} />
                                  </button>
                                </div>
                              </Alert>
                            </div>
                            :
                            !swapData && swapResponse ?
                              <div className="sm:pt-1.5 pb-1">
                                <Alert
                                  color={`${swapResponse.status === 'failed' ? 'bg-red-400 dark:bg-red-500' : swapResponse.status === 'success' ? 'bg-green-400 dark:bg-green-500' : 'bg-blue-400 dark:bg-blue-500'} text-white`}
                                  icon={swapResponse.status === 'failed' ? <BiMessageError className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" /> : swapResponse.status === 'success' ? <BiMessageCheck className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" /> : <BiMessageDetail className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" />}
                                  closeDisabled={true}
                                  rounded={true}
                                >
                                  <div className="flex items-center justify-between space-x-1">
                                    <span className={`break-${isBreakAll(swapResponse.message) ? 'all' : 'words'} font-mono text-sm`}>{swapResponse.message}</span>
                                    <button
                                      onClick={() => setEstimateTrigger(moment().valueOf())}
                                      className="bg-red-500 dark:bg-red-400 flex items-center justify-center text-white rounded-full p-2"
                                    >
                                      <MdRefresh size={20} />
                                    </button>
                                  </div>
                                </Alert>
                              </div>
                              :
                              swapData ?
                                <TransactionState
                                  data={swapData}
                                  buttonTitle={<span>View Transaction</span>}
                                  buttonClassName="hidden w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 rounded-lg shadow-lg flex items-center justify-center text-gray-100 hover:text-white text-base sm:text-lg space-x-2 py-4 px-3"
                                  onClose={() => reset()}
                                  cancelDisabled={true}
                                />
                                :
                                estimateTrigger ?
                                  <div className="sm:pt-1.5 pb-1">
                                    <Alert
                                      color="bg-blue-400 dark:bg-blue-600 text-left text-white"
                                      icon={<BiMessageDots className="w-4 sm:w-6 h-4 sm:h-6 stroke-current mr-3" />}
                                      closeDisabled={true}
                                      rounded={true}
                                    >
                                      <div className="flex items-center justify-between space-x-1">
                                        <span className="font-mono text-sm">Please retry insert the amount.</span>
                                        <button
                                          onClick={() => setEstimateTrigger(moment().valueOf())}
                                          className="bg-blue-500 dark:bg-blue-500 flex items-center justify-center text-white rounded-full p-2"
                                        >
                                          <MdRefresh size={20} />
                                        </button>
                                      </div>
                                    </Alert>
                                  </div>
                                  :
                                  null
              :
              web3_provider ?
                <button
                  disabled={true}
                  className="w-full bg-gray-200 dark:bg-gray-800 cursor-not-allowed rounded-lg shadow-lg flex items-center justify-center text-gray-400 dark:text-gray-500 text-base sm:text-lg font-semibold space-x-2 py-4 px-3"
                >
                  <span>Swap</span>
                  <span className="font-semibold">{fromAsset?.symbol}</span>
                </button>
                :
                <Wallet
                  buttonConnectTitle={<>
                    <span>Connect Wallet</span>
                    {/*<Img
                      src="/logos/wallets/metamask.png"
                      alt=""
                      className="w-6 h-6 -mr-0.5 mb-0.5"
                    />*/}
                  </>}
                  buttonConnectClassName="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 rounded-lg shadow-lg flex items-center justify-center text-gray-100 hover:text-white text-base sm:text-lg font-semibold space-x-2.5 py-4 px-3"
                />
            }
            {tokenApproveResponse && (
              <Notification
                hideButton={true}
                outerClassNames="w-full h-auto z-50 transform fixed top-0 left-0 p-0"
                innerClassNames={`${tokenApproveResponse.status === 'failed' ? 'bg-red-500 dark:bg-red-600' : tokenApproveResponse.status === 'success' ? 'bg-green-500 dark:bg-green-600' : 'bg-blue-600 dark:bg-blue-700'} text-white`}
                animation="animate__animated animate__fadeInDown"
                icon={tokenApproveResponse.status === 'failed' ?
                  <FaTimesCircle className="w-4 h-4 stroke-current mr-2" />
                  :
                  tokenApproveResponse.status === 'success' ?
                    <FaCheckCircle className="w-4 h-4 stroke-current mr-2" />
                    :
                    <FaClock className="w-4 h-4 stroke-current mr-2" />
                }
                content={<span className="flex flex-wrap items-center">
                  <span className="mr-1.5">{tokenApproveResponse.message}</span>
                  {tokenApproveResponse.status === 'pending' && (
                    <Loader type="ThreeDots" color={theme === 'dark' ? '#FFFFFF' : '#FFFFFF'} width="16" height="16" className="mt-1 mr-1.5" />
                  )}
                  {fromChain?.explorer?.url && tokenApproveResponse.tx_hash && (
                    <a
                      href={`${fromChain.explorer.url}${fromChain.explorer.transaction_path?.replace('{tx}', tokenApproveResponse.tx_hash)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center font-semibold mr-1.5"
                    >
                      <span>View on {fromChain.explorer.name}</span>
                      <TiArrowRight size={20} className="transform -rotate-45" />
                    </a>
                  )}
                  {['success'].includes(tokenApproveResponse.status) && typeof tokenApproveResponseCountDown === 'number' && (
                    <span>(close in {tokenApproveResponseCountDown}s)</span>
                  )}
                </span>}
              />
            )}
          </div>
          {['testnet'].includes(process.env.NEXT_PUBLIC_NETWORK) && (
            <>
              <div />
              <div className="w-full max-w-lg bg-white dark:bg-black rounded-2xl flex flex-col items-center justify-center">
                <Faucets/>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="col-span-1 lg:col-span-2 mb-4">
        <ActiveTransactions
          setActiveTransactionOpen={open => setActiveTransactionOpen(open)}
        />
      </div>
    </div>
  )
}