# Antelope Resource Provider

The Antelope Resource Provider application provides the following features:

- **Resource Manager**: Automatically manage network resources (CPU + NET, optionally RAM) for a configured list of accounts using PowerUp.
- **Resource Provider**: HTTP API that cosigns transactions to cover network resources on behalf of requesting accounts. Supports a free tier (per-account daily CPU/NET limits) and a paid tier (fee transfer appended to the transaction).
- **Light Account Cosigning**: HTTP API that cosigns `authkey` transactions for light accounts, billing the PowerUp cost plus a configurable margin.
- **Self-Management**: The service account automatically PowerUps itself (and optionally buys RAM) on a schedule so it stays operational.
- (INCOMPLETE) **Request a Powerup**: Direct per-account PowerUp endpoint. Implementation exists in-tree but is currently disabled.

## NOTE: THIS APPLICATION IN DEVELOPMENT

This application is in development and is not yet ready for production use. If you accept this risk, you are free try and use it.

Please report any bugs you may encounter.

## Getting Started

To get started, you will need the following:

1. A Linux server you can download and run the application on.
2. An account on the network that the service will use to interact with the blockchain.
3. A balance of the system token for that network the account can use to obtain resources.

## Download or Build

Precompiled binaries can be downloaded directly from the [Releases](https://github.com/greymass/resource-provider/releases) page. Download the binary, decompress the gzip file, and place it into a directory of your choice.

Alternatively, you can clone down this repository and run `make build` to create the binary yourself. The resulting files can be found in the `./dist` directory inside the project.

## Configuration

This application requires an `.env` file in the same folder to control many of its settings.

Running `rpcli env init` will generate a basic `.env` file in the folder you run it from. This file will need to be edited to configure the blockchain, accounts, and services involved.

Alternatively, the `.env.example` file can be copied directly to the `.env` and edited.

Configuration lives in two places:

- **`.env` file** — deployment shape: the blockchain, accounts, keys, which services are enabled, ports, and logging.
- **Database settings** — provider policy: limits, fees, and thresholds, managed with the `rpcli config` commands. Changes take effect in a running service within a few seconds; no restart required.

```
rpcli config list                # show all settings, values, and defaults
rpcli config get <key>           # show one setting
rpcli config set <key> <value>   # change a setting (validated)
rpcli config unset <key>         # revert a setting to its default
```

## Setup as Resource Mananger

### Modify Configuration

To start managing the resources of Antelope accounts, the `.env` file requires two things:

```
# Enable the resource manager by setting this value to true
ENABLE_RESOURCE_MANAGER=true

# Enter the account name of the dedicated resource management account
MANAGER_ACCOUNT_NAME=accountname
```

A number of other optional configuration values may be set and can be found inside the `.env`.

If no private key is defined within the `.env` file, one will be generated automatically for use within the service.

### Account Permission Setup

With the above settings defined in the `.env` file, run the following command:

```
rpcli manager setup
```

This command will generate a link that will assist in setting up the proper permissions for the account. Visit the Unicove link in your browser, ensure you are logged in with the dedicated manager account, review the transaction and sign it.

This new permission will be restricted to managing resources and use the key embedded within the service.

To remove this permission in the future, you can do so manually or run:

```
rpcli manager unauthorize
```

### Add accounts to manage

The `rpcli` allows you to define which accounts will be automatically managed.

To add an account, use the `rpcli manager add` command:

```
rpcli manager add <account> <min_ms> <min_kb> <inc_ms> <inc_kb> <max_fee>
```

The values required for this command are as follows:

- `account` is the account name to manage resources for
- `min_ms` the minimum amount of CPU (in milliseconds) the account should have available
- `min_kb` the minimum amount of NET (in kilobytes) the account should have available
- `inc_ms` the amount of CPU (in milliseconds) to powerup when the minimum is not met
- `inc_kb` the amount of NET (in kilobytes) to powerup when the minimum is not met
- `max_fee` the maximum fee to pay for the powerup action

So for example, to ensure the `ihasnocpunet` account always has 10ms and 10kb resources available, and setting the maximum fee to `0.5000 TOKEN`, the command would be:

```
rpcli manager add ihasnocpunet 10 10 10 10 0.5
```

To modify the values set for an account, just run `rpcli manager add` again for the account and it will overwrite its configuration.

### Listing managed accounts

To display the accounts currently under management and their configurations, run the following command.

```
rpcli manager list
```

A list of accounts will be displayed on the command line as follows:

```
┌───┬──────────────┬────────┬────────┬────────┬────────┬──────────┐
│   │ account      │ min_ms │ min_kb │ inc_ms │ inc_kb │ max_fee  │
├───┼──────────────┼────────┼────────┼────────┼────────┼──────────┤
│ 0 │ ihasnocpunet │ 10     │ 10     │ 10     │ 10     │ 0.5000 A │
└───┴──────────────┴────────┴────────┴────────┴────────┴──────────┘
```

### Removing an account from management

To completely remove an account from management, use the `manager remove` command followed by the account name:

```
rpcli manager remove ihasnocpunet
```

## Setup as Resource Provider

The Resource Provider runs an HTTP API that cosigns transactions to cover CPU and NET for requesting accounts. It uses a dedicated account (distinct from the manager account) whose permission is restricted to the noop action (and the light account `authkey` action, if enabled).

### Modify Configuration

At minimum:

```
# Enable the provider API
ENABLE_RESOURCE_PROVIDER=true

# The cosigning account
PROVIDER_ACCOUNT_NAME=accountname

# Enable one or more cosigning modes:
ENABLE_FREE_TRANSACTIONS=true
ENABLE_PAID_TRANSACTIONS=true
```

If no `PROVIDER_ACCOUNT_PRIVATEKEY` is set, one will be generated on first run.

### Provider Policy Settings

Provider policy is stored in the database and managed with `rpcli config` (see [Configuration](#configuration)). The service refuses to start if a setting required by an enabled feature is unset, and the startup error names the exact command to run.

**Free cosigning** (`ENABLE_FREE_TRANSACTIONS=true`) tracks per-account usage over a rolling window:

| Setting                       | Default | Description                  |
| ----------------------------- | ------- | ---------------------------- |
| `provider.usage.window_hours` | 24      | Rolling usage window (hours) |

### Free-tier buckets and rules

Free cosigning routes each transaction into a usage **bucket** based on **rules** that match the transaction's `contract::action`s. Each bucket has its own per-account CPU/NET limits and a fallback priority. Manage them with `rpcli rules`:

    rpcli rules bucket add wildcard 1000 5 10          # a catch-all bucket: 5ms CPU / 10kb NET
    rpcli rules add wildcard wildcard                  # a rule feeding it
    rpcli rules allow wildcard '*::*'                  # matching every action

    rpcli rules bucket add shipload 10 100 100         # a generous game bucket
    rpcli rules add game shipload
    rpcli rules allow game 'eon.shipload::*'
    rpcli rules allow game 'nex.shipload::*'

A transaction matches a rule when every action is covered by an `allow`/`require` pattern and every `require` pattern is present. Each authorizing account is billed the full cost against the highest-priority matching bucket it still has room in, spilling to lower-priority buckets when full. Delete the wildcard bucket to cover only specific contracts. The service refuses to start if free transactions are enabled and no bucket exists.

Upgrading from the previous single-limit version: on first start, the old `provider.free_transactions.limit_ms/kb` values are seeded automatically into a `wildcard` bucket.

**Paid cosigning** (`ENABLE_PAID_TRANSACTIONS=true`, the default) appends a fee transfer to the cosigned transaction:

| Setting                                      | Default                | Description                                       |
| -------------------------------------------- | ---------------------- | ------------------------------------------------- |
| `provider.paid_transactions.minimum_fee`     | `0.0001 <token>`       | Minimum fee for any paid transaction              |
| `provider.paid_transactions.fee_recipient`   | cosigner account       | Account that receives fees                        |
| `provider.paid_transactions.fee_memo`        | `Fuel Transaction Fee` | Memo prefix on the fee transfer                   |
| `provider.paid_transactions.fee_default_ref` | `teamgreymass`         | Referrer appended to the memo as `\| ref={value}` |

**Resource-need gating** applies to all cosigning modes — accounts that already have sufficient resources are refused:

| Setting                          | Default | Description                                     |
| -------------------------------- | ------- | ----------------------------------------------- |
| `provider.require_resource_need` | `true`  | Only cosign for accounts that need resources    |
| `provider.min_cpu_us`            | 50000   | CPU (µs) below which an account is "in need"    |
| `provider.min_net_bytes`         | 50000   | NET (bytes) below which an account is "in need" |

**Free powerups** (`ENABLE_FREE_POWERUP=true`) require `provider.free_powerup.ms`, `provider.free_powerup.kb`, `provider.free_powerup.uses`, and `provider.free_powerup.max_payment`.

See `.env.example` for the remaining environment options, such as the light account cosigning feature (`ENABLE_LIGHTACCOUNT_PROVIDER`).

### Account Permission Setup

With the provider configuration in place, run:

```
rpcli provider setup
```

This generates a signing request that creates the dedicated provider permission on the account, binds the provider's key to it, and links the permission to the noop action (and the light account `authkey` action, if `ENABLE_LIGHTACCOUNT_PROVIDER=true`). Open the printed link in your browser, sign with the account's active permission, then re-run the command to verify the account is configured.

## Self-Management

When `ENABLE_SELF_MANAGEMENT=true` (the default), the service runs a cron job that keeps the configured `MANAGER_ACCOUNT_NAME` operational by automatically PowerUp-ing CPU and NET when it drops below `MANAGER_MIN_MS` / `MANAGER_MIN_KB`, and (if `MANAGER_BUYRAM_ENABLED=true`) buying a small amount of RAM when the account falls below `MANAGER_RAM_MINIMUM_KB`. Each cycle caps payment at `MANAGER_MAX_FEE`. The schedule is controlled by `MANAGER_SELF_CRONJOB`.

This feature requires the same account setup as the Resource Manager (`rpcli manager setup`).

## Running the Services

Start everything:

```
rpcli start
```

Or start a single service:

```
rpcli start api
rpcli start manager
```

## Usage and Database Commands

```
rpcli usage <account>   # Show cosigning usage for an account (within provider.usage.window_hours)
rpcli reset             # Clear all usage-tracking records
rpcli vacuum            # Force SQLite VACUUM on the database
```

### Tests

`make test`
