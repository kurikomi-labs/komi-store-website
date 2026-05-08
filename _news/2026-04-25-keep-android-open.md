---
title: "Keep Android Open: where GitHub Store stands"
description: Our public position on Google's developer-verification policy — and
  the three commitments that come with it.
date: 2026-04-25
tags:
  - policy
  - android
draft: false
redirect_from:
  - /news/keep-android-open/
---
GitHub Store stands with the open letter.

## What's happening

In March 2026, Google began requiring Android app developers to verify their identity through Google's Developer Console — including developers who distribute their apps entirely outside the Play Store, on their own GitHub releases pages or through third-party stores. From September 2026, certified Android devices in Brazil, Indonesia, Singapore, and Thailand will refuse to install apps from unverified developers. Global enforcement follows in 2027.

The stated rationale is reducing fraud and malware. That's a real problem. We don't dispute that. We dispute that requiring every open-source maintainer in the world to register a business relationship with Google is the right way to address it.

F-Droid has stated publicly that the policy, if enforced as announced, would end the F-Droid project. The open letter against it has been signed by more than 65 organizations from 21 countries — including EFF, FSFE, KDE, Brave, The Tor Project, FOSDEM, Article 19, Signal (via Molly), and Obtainium. GitHub Store is on the [signatories list](https://keepandroidopen.org/open-letter/#signatories).

## What this changes for sideloading

Most users won't notice anything until late 2026. After that, on certified Android devices in enforcement countries, the install picture splits in three:

- **Apps from Play Store**: continue working, no change.
- **Apps from sideload, by a Google-verified developer**: continue working.
- **Apps from sideload, by a maintainer who hasn't registered with Google**: blocked at install time.

The third category is most of the open-source Android ecosystem. The category we exist to serve.

## Where GitHub Store stands

Three commitments, in writing:

1. **We will not require any developer whose app you install through GitHub Store to be verified by Google.** No filter. No catalog gating. No two-tier discovery.
2. **We will not display "verified developer" badges that imply unverified developers are less trustworthy.** That framing is the part of the policy we disagree with most directly.
3. **We will keep distributing GitHub Store itself through direct download alongside Play Store.** The direct-download build will continue installing on de-Googled Android, custom ROMs, and Android versions before enforcement. If the Play Store version is ever forced to disable functionality the direct-download version provides, we'll say so, on the install page, before you download.

If we ever drift from those three, the edit history of this post is the receipt.

## What this means for you

- **In countries without enforcement** (most of the world through 2027): no change. Install whatever you want.
- **In Brazil, Indonesia, Singapore, or Thailand starting September 2026**: certified devices will block unverified-developer apps. GitHub Store will detect this and surface an alternative-install flow — clear instructions for installing through ADB, custom recovery, or vendor-specific paths, plus a direct link to the project's official Telegram, Matrix, or GitHub Discussions where the maintainer typically distributes. We'll do the documentation work so you don't have to find it for every app.
- **On de-Googled Android** (LineageOS, GrapheneOS, /e/OS, and others): no change ever. These platforms are not "certified Android" and the verification check does not apply.
- **On all other platforms** (Linux, Windows, macOS): no change. This policy is Android-specific.

## What this means for us

- **GitHub Store itself**: the binary published on Play Store will, by necessity, be associated with a Google-verified developer account — that's how Play Store works and always has. The same binary, signed with the same key, will continue to be available as a direct download from our GitHub releases. We've tested the direct-download path end-to-end on de-Googled devices and on Android versions before enforcement. It works. We will keep that path working.
- **Coordination**: we are talking with F-Droid, Obtainium, the EFF, and the broader Keep-Android-Open coalition about a shared technical strategy for the alternative-install flow. The goal is one consistent UX across the FOSS Android ecosystem rather than each app reinventing the same flow. Concrete deliverables are being worked on; expect a joint write-up later in 2026.
- **No new "trust signals" tied to the verification regime**: when we ship anti-feature labels, signing-key continuity displays, and CVE monitoring, none of them will reference Google verification status. The trust signal we ship is technical, not bureaucratic.

## What you can do

1. **Sign the open letter** if you agree. The coalition site is [keepandroidopen.org](https://keepandroidopen.org).
2. **Use unverified open-source apps anyway**, where you can. The policy can be enforced technically, but it can't be enforced socially. The more users go to the trouble of alternative-installing, the weaker the framing that this is a security policy gets.
3. **Tell hardware vendors that certified Android isn't an exclusively-desirable feature.** Vendors who ship de-Googled options exist; demand drives supply. Fairphone, /e/Foundation, and others have made business cases out of the alternative.
4. **Support F-Droid** financially or as a contributor. Their build infrastructure is the most-impacted institution in the FOSS ecosystem under this policy. They are also the most experienced at coordinating against changes like this.

## Why we're saying this on the record

If we hadn't shipped this position, GitHub Store would still be a useful product. With this position, GitHub Store is an aligned product. We think the second is worth the few percentage points of reach we'll lose in enforcement countries.

We also think that being unambiguous about where we stand is more honest than the typical posture of "we're neutral on policy, we just ship software." Software shapes what's possible; "neutral" is a position. We'd rather pick the position than pretend we don't have one.

— The GitHub Store team
