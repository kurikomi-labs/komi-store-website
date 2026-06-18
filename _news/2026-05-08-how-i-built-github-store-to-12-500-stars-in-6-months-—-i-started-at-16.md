---
title: How I built Komi Store to 12,500 stars in 6 months - I started at 16
slug: how-i-built-komi-store
description: "I built Komi Store — a cross-platform app store for GitHub
  releases — in a one-week MVP sprint. Six months later: 12,500+ stars, 250,000+
  updates served, and the part where I almost quit at 3,000 stars."
date: 2026-05-09
tags:
  - founder-essay
  - foss
draft: false
---
# How I built Komi Store to 12,500 stars in 6 months - I started at 16

Six months ago I was a 16-year-old in Uzbekistan trying to ship a small Android app I'd built. The Play Store process was so heavy for what the project was worth, I built an alternative instead.

Six months later that alternative - Komi Store - has 12,500+ stars, 250,000+ updates served, ships in 13 languages, runs on Android + Windows + macOS + Linux. I turned 17 a couple of weeks ago.

This is the story. Including the part where I almost quit.

## The Play Console wall

I'd shipped apps to the Play Store before. Those felt worth it - real apps, real users, the friction was the cost of doing business.

This time was different. I was working on Philipp Lackner's Mobile Dev Campus challenge. Built a small side project I was proud of. Wanted to publish it. Re-read the Play Console requirements and just stopped.

$25 fee. Government ID. Address verification. 20 closed testers. 2-week minimum closed test. Wait. Maybe approved.

A month of process. For a side project. The math wasn't there.

GitHub already lets developers publish APKs in releases. So I figured: build a store on top of that.

That gap was the project.

## What I didn't know

Honest admission: when I started, I didn't know F-Droid or Obtainium existed. People told me about them later, after I'd shipped. If I'd known on day one, I probably wouldn't have built Komi Store at all. I would've just installed Obtainium and moved on.

Sometimes ignorance is a feature.

## Why Kotlin Multiplatform

Native Android dev for about two years before this. Kotlin was my language. Compose was my UI toolkit.

KMP let me bring two years of Android straight into Desktop without changing language, IDE, or mental model. I picked it because I could ship faster.

## The 1-week MVP, no coding agents

Komi Store's first version shipped in a single week.

Full focus. Skipped school. Skipped studies. Some nights I barely slept.

Zero coding agents. No Cursor, no Copilot, no Claude Code. Just Android Studio, the Compose Multiplatform docs.

What shipped:

* GitHub Releases search via the public API
* Asset filter — APKs and Desktop installers, hide the noise
* Tap-to-install on Android via the system installer
* One UI codebase: Android + Windows + macOS + Linux

Crude. But real. It worked.

I posted it on LinkedIn before it was even technically an MVP - the first real LinkedIn post I'd ever made. ~100 reactions, 5,000+ impressions, on a profile that had basically nothing on it before. Then I posted in the Kotlin Slack community a few days later.

## The trajectory

I started on November 21, 2025. Built it private for a week. Made the repo public in late November. November 30 - first star.

December 15: 100 stars.

January 3: 2,500.

I genuinely didn't understand what was happening. The growth was slow, then suddenly it wasn't. Made a LinkedIn post celebrating each milestone - those got more reactions than the launch did.

![Star history chart from November 2025 first star to January 2026 reaching 2,500 stars — slow start, then exponential](/assets/uploads/star-history-202659.png)

The biggest amplifier in that window was [HowToMen](https://www.youtube.com/@howtomen) - at around 2,000 stars, he featured Komi Store in his *Top 12 App Stores Better than Play Store* video. His audience is exactly who the app is for: privacy-aware Android users who already mistrust Play. The trajectory after that video looked different.

The inevitable comparison: yes, I know about [Obtainium](https://github.com/ImranR98/Obtainium). I get asked "why not Obtainium?". Obtainium is the lightweight power-user updater for repos you already know about. Komi Store is the discovery-first store for people who don't know what to install yet - and it's cross-platform. Use Obtainium. Use Komi Store. Use both. We built Obtainium import/export so libraries move between them in one tap.

## The valley at 2-3k stars

The part I almost cut from this essay.

Around 2-3,000 stars I went strange. Heads-down for months. Product getting attention. People writing nice things. Issues piling up.

And I started losing the plot.

I'd open the repo and just stare. *Why am I doing this. Is anyone going to use this long-term. Is the star count just vanity. Am I spending my life on something that doesn't matter.*

I talked to ChatGPT for hours during that period. One- or two-hour conversations. Not for code help - to think out loud. Friends my age weren't building products. The doubt didn't have anyone in my life shaped right to engage with it.

What pulled me out wasn't an insight. It was specific user messages. A dev DMing to say their workflow had changed. A bug report starting "I love this app, but...". A maintainer claiming their repo and saying it was the first time their project had a real *store page*. None of them knew I was second-guessing anything. They were just users using a thing.

If you're building something: the valley is real. External success doesn't make you feel anything; it just sits there. Tangible feedback from real users is what helps. Make it easy for them to reach you.

## What I'd tell 16-year-old me

**Ship first, know your audience second.** I didn't research the audience before I shipped. The audience showed up - FOSS users who love tinkering, hate ads, hate tracking, want privacy. Knowing that landed me on every product decision afterward: open backend, no telemetry, donations rails, no dark patterns. Ship before you finish researching. The audience teaches you faster than your assumptions.

**KMP works. Even on Desktop.** The cross-platform claim isn't marketing.

**Distribution is a feature.** F-Droid, Obtainium config, Scoop, Winget, IzzyOnDroid - every channel I added was a product feature. Users who can't install you don't exist.

**Talk to your users. Directly. Inside the app.** Release notes don't cut it. Most people don't read them - I've never opened "What's new" on a Play Store page in my life. So I built an in-app what's-new sheet (short, bullet-format) that pops up after every update, an announcements feed for surveys and security notes, a *Send feedback* card with a diagnostics preview before you send, and a Discord. The first real survey I ran told me what 12,000 stars couldn't.

**Localize early.** People will use your app worldwide if it's good and they can read it. The limiters are language and network. Komi Store ships in 13 languages and runs through a backend proxy that survives the Great Firewall. That's why Chinese, Russian, and Arabic users are here.

**The hardest part isn't the code.** Nobody warned me about the valley.

## What's next

A lot more coming. A new design that's substantially nicer than what's there today. Better Desktop support - potentially with the same auto-update story Android already has. UX 100x better than now.

A paid tier eventually. One principle: Komi Store charges only for features that cost us money to run. Storage, bandwidth, compute, monitoring. Anything that runs on your device stays free, forever. Backend is open source and self-hostable.

If you've read this far - try it. If you're a dev whose project ships APKs or Desktop installers, claim your store page (free, soon). And if you're a teenager somewhere thinking about shipping a project: just start. The Play Store will wait. GitHub Releases is right there.

— Usmon (Founder of Kurikomi)
