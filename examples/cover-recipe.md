# Prepare a cover draft for a Short

This optional recipe prepares a square cover draft for human review. It uses
Delx Commerce's separately installed image kit, with a free quote first and an
explicit operator decision before payment. The generated `image.webp` is local
artwork. Choose or edit the final cover in the appropriate YouTube workflow.

You need Node.js 22 or 24, npm and Git. Keep the purchase directory outside a Git
working tree because it temporarily holds a payment authorization. Reuse that
same directory, title and price ceiling when approving or resuming one cover.

## 1. Preview offline

From the YouTube Shorts Agent repository root, point at a local video. This step
needs no kit, wallet or network, does not create a purchase and does not transmit
the title. The JSON plan reports the square `1:1` aspect ratio.

```sh
node examples/cover-recipe.mjs \
  --video ./short.mp4 --title "An agent prepares its first Short" \
  --job-directory "$HOME/.local/share/youtube-shorts-agent/covers/first-short" \
  --max-price 0.01 --offline
```

## 2. Install the separate image kit

The public kit is pinned to revision `eb9c8fab956057994e4be7b9e34f7b073f1f3405`.
The recipe checks its client, package manifests and lockfile against that revision
before invoking it. The kit provides payment replay and full WebP decoding.
Install it in your own tools directory.

```sh
git clone https://gist.github.com/1f16a4604e4e85a3715087795f22d9d9.git "$HOME/delx-image-kit-source"
git -C "$HOME/delx-image-kit-source" checkout --detach eb9c8fab956057994e4be7b9e34f7b073f1f3405
sh "$HOME/delx-image-kit-source/setup.sh" "$HOME/delx-image-workflow"
npm ci --ignore-scripts --prefix "$HOME/delx-image-workflow"
npm test --prefix "$HOME/delx-image-workflow"
```

## 3. Request the free quote

The quote sends the derived cover prompt and `image-workflow-v1` source to Delx
Commerce. It uses no wallet and sends no payment, even when a key is configured.
The client rejects a price above the specified ceiling. It saves the quoted
request privately so the approval can apply to that exact request.

```sh
node examples/cover-recipe.mjs \
  --video ./short.mp4 --title "An agent prepares its first Short" \
  --job-directory "$HOME/.local/share/youtube-shorts-agent/covers/first-short" \
  --kit-directory "$HOME/delx-image-workflow" --max-price 0.01
```

## 4. Approve this quoted purchase

Review the quote. Only after the operator approves this purchase, supply
`DELX_IMAGE_PRIVATE_KEY` through the operator's secret manager and repeat the same
command with `--pay`. `YOUTUBE_DRY_RUN` does not authorize an image payment.
The client supports exact USDC payments on Base.

```sh
node examples/cover-recipe.mjs \
  --video ./short.mp4 --title "An agent prepares its first Short" \
  --job-directory "$HOME/.local/share/youtube-shorts-agent/covers/first-short" \
  --kit-directory "$HOME/delx-image-workflow" --max-price 0.01 --pay
```

The kit persists one authorization before sending it and retries with the same
payment identifier and proof. After a timeout, retain the purchase directory and
resume the same command. A new directory represents a new purchase. If a crash
leaves `workflow.lock`, confirm that its process has stopped before removing that
lock. Expired or rejected authorizations need operator investigation.

On success, the kit verifies receipt price, HTTPS origin, byte length, SHA-256,
WebP container, dimensions and decoded pixels before saving `image.webp` in the
purchase directory. A completed resume checks the local file without another
purchase. Copy the verified artwork to the video's editing workspace for review.
The video upload remains the existing `upload-short` command.

## Test without spending

```sh
node --test test/cover-recipe.test.js
```

These recipe tests exercise the actual command with private temporary files,
offline mode, ambiguous approval flags and Git storage boundaries. The separate
kit's tests exercise signed payment retries against a local fixture and reject
corrupt WebP files. Neither test command makes a purchase.
