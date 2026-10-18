# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + Vite (as named in the spec), served by the hub. Recharts where it fits the chart design,
otherwise hand-made SVG charts. Installed as a PWA from Chrome on a Pixel 9.

## Users

One person, the owner. They lift with openGym, run with a Pixel Watch 3, and log meals by sending
photos to Claude. They open the dashboard on their phone, usually in the morning after 09:00, to
see yesterday's analysis and how the week is going. They often don't wear the watch, especially at
night, so sleep, HRV, resting HR and weight are often missing.

## Product Purpose

Fitness Hub puts gym, running, health and food data in one Postgres database on a laptop at home,
and uses Claude (through a subscription, never pay-per-token APIs) for every piece of analysis.
The dashboard is the one place to see that data and Claude's latest analysis. Success: the owner
opens it after 09:00 and sees yesterday's analysis every day, without opening Hevy, Google Health
or Claude.

## Positioning

A personal, self-hosted hub where the analysis is written by Claude through scheduled tasks and
the MCP connector, and the dashboard only shows it. The dashboard never calls an LLM.

## Operating Context

- Data arrives by a nightly sync at 21:00 Bangkok, a "Sync now" button, or Claude's `trigger_sync`.
  All three queue jobs in `sync_log`, and the sync worker runs them.
- Claude writes a daily analysis at 09:00 and a weekly review on Mondays at 09:30, in Thai.
- Meals are logged from photos in the Claude app. Photo estimates are off by ±20–30%, so 7-day
  trends matter more than single meals.
- Days are calendar days in Asia/Bangkok.
- "Ask Claude" can only open the Claude app or Project. It cannot pre-fill a message.

## Capabilities and Constraints

- Read-only, except the Sync now button (`POST /api/sync`, then poll `GET /api/sync/:id` every 3 s).
- Pages: Today, Training, Running, Body, Insights (spec "Dashboard PWA").
- Load from cache first and refresh on open. Show when data was last updated, taken from `sync_log`.
  The spec targets a load under 1 second from cache.
- Behind Cloudflare Access (email PIN) at `fit.ittyy.dev`, like the rest of the hub.
- Interface language: English. Claude's analysis text is Thai, so the type must render Thai well.
- Missing watch data is normal and not an error.

## Brand Commitments

Name: Fitness Hub. No logo or brand assets exist yet.

## Evidence on Hand

Real data is private health data. The repository is a public portfolio, so screenshots, fixtures and
demo content must use fake data, never the owner's numbers, meals, photos or name.

## Product Principles

1. Yesterday's analysis first: the reason to open the app is Claude's take, so it leads.
2. Trends over single numbers, because meal estimates are rough and watch data has gaps.
3. Missing data is stated calmly, once, never shown as a failure.
4. Glanceable on a phone in the morning, in one hand.
5. Private by default: nothing public, nothing personal in the repo.
