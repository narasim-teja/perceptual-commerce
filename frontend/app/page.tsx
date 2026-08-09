/**
 * THE FRONT PAGE.
 *
 * The console at /try is a specimen sheet: it operates. This page is what the
 * same print shop issues when it needs to tell: a broadsheet front page.
 * Nameplate, one headline, a lede that states the mechanism, the authored
 * shelf as the front-page plate (drawn live by the real reduction chain), the
 * three planes as ruled columns, one real run as the printed record, the
 * refusal as a hatched field, and an evidence box a judge can lean into.
 *
 * Every number on this page is real or labelled synthetic. The run record is a
 * live run from 2026-08-09; the ruling hash resolves on the explorer.
 */

import type { ReactNode } from "react";
import { Plate } from "@/components/plate";

const CONTRACT = `<!--
THESIS: the console's print shop issues its front page: the mechanism told as news, with the
  evidence set in boxes. Refuses the SaaS-landing rut: gradient hero, icon cards, logo river.
OWN-WORLD: inherited whole from the bitmap specimen (DESIGN.md): newsprint #F5F3EC, ink #0A0A0A,
  #FF5A3C only as a filled field, Silkscreen at integer steps, Archivo text, Azeret Mono data,
  square corners, 2px rules, real halftone imaging.
STORY: a visitor knows in one viewport what this is (perception into bounded payment), watches
  the firing condition become true on the plate, reads one real run, and opens the console.
FIRST VIEWPORT: dateline, nameplate with double rule, headline left with lede and the primary
  action, the live halftone plate right with the 12x9 inset.
FORM: broadsheet front page, grounded candidate 6, seed key 89bfd05c.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
  verdict, and DESIGN.md
-->`;

const REPO = "https://github.com/narasim-teja/perceptual-commerce";
const EXPLORER = "https://testnet.monadexplorer.com";
const GATE = "0x8FbB75A725e9C09C0Cc1680795D90409732381cA";
const RULING = "0x065b210bede9f87cbee555916a508faecfc6a754bfc813908495c3840c002e4c";

/** kit.Button's exact physics, as an anchor: the landing page only navigates. */
function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  children,
  external = false,
}: {
  href: string;
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
  children: ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={[
        "bit inline-block border-2 border-ink text-center transition-transform duration-100 ease-out",
        "shadow-[0_0_0_var(--ink)] hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[4px_4px_0_var(--ink)]",
        "active:translate-x-0 active:translate-y-0 active:shadow-[0_0_0_var(--ink)]",
        size === "lg" ? "bit-16 px-4 py-[14px]" : "bit-12 px-3 py-[10px]",
        variant === "primary" ? "bg-signal text-ink" : "bg-paper text-ink hover:bg-paper-2",
      ].join(" ")}
    >
      {children}
    </a>
  );
}

/** A broadsheet fact row: label, dashed leader, value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-dashed border-paper-3 py-[7px] last:border-b-0">
      <span className="label shrink-0">{label}</span>
      <span className="min-w-0 flex-1 border-b border-dashed border-paper-3" aria-hidden />
      <span className="datum min-w-0 text-right break-words text-ink-2">{children}</span>
    </div>
  );
}

/** One row of the printed run record, in the console's own grammar. */
function RunRow({
  at,
  mark,
  weight,
  children,
}: {
  at: string;
  mark: string;
  weight: "permit" | "paper";
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 border-b border-dashed border-paper-3 px-3 py-[8px] last:border-b-0">
      <span className="datum w-[54px] shrink-0 pt-[6px] text-[10px] text-ink-3">{at}</span>
      <span
        className={[
          "bit bit-12 w-[104px] shrink-0 border-2 border-ink px-[5px] py-[6px] text-center leading-[1.2]",
          // The console's own grammar: a solid ink field is a permit, and only
          // a permit. Everything else stands on paper.
          weight === "permit" ? "field-permit" : "bg-paper-2 text-ink",
        ].join(" ")}
      >
        {mark}
      </span>
      <span className="datum min-w-0 flex-1 pt-[4px] break-words text-ink-2">{children}</span>
    </li>
  );
}

export default function FrontPage() {
  return (
    <div className="mx-auto max-w-[1120px] px-4 pb-10 lg:px-6">
      <div hidden aria-hidden dangerouslySetInnerHTML={{ __html: CONTRACT }} />

      {/* ─── dateline ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-ink py-[8px]">
        <span className="label">saturday, august 9, 2026</span>
        <span className="label hidden sm:inline">monad testnet edition</span>
        <span className="label">price: bounded</span>
      </div>

      {/* ─── nameplate ────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="flex items-center gap-3">
          {/* The mark, printed as the plate version: ink block, paper aperture. */}
          <img src="/logo.svg" alt="" className="size-10 shrink-0 border-2 border-ink" />
          <h1 className="bit bit-24 sm:bit-32 text-ink">perceptual-commerce</h1>
        </div>
        <nav className="flex items-center gap-2">
          <LinkButton href="/try">try the console</LinkButton>
          <LinkButton href={REPO} external>
            github
          </LinkButton>
        </nav>
      </header>
      {/* The broadsheet's double rule. */}
      <div className="border-b-4 border-ink" />
      <div className="mt-[3px] border-b border-ink" />

      {/* ─── the fold ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 py-7 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
        <div className="flex min-w-0 flex-col">
          <p className="bit bit-12 bg-ink px-2 py-[6px] text-ink-inv w-fit">
            the perception layer for agentic commerce
          </p>
          <h2 className="bit bit-32 mt-4 leading-[1.15] text-ink">
            the machine watches. the chain decides. the money moves.
          </h2>
          <p className="mt-4 max-w-[62ch] text-[15px] leading-[1.6] text-ink-2">
            Humans can decide to buy. Humans cannot watch continuously for the moment to buy.
            perceptual-commerce closes that gap: an SDK that turns a real-world condition into a
            bounded payment. Perception can only propose. An onchain contract on Monad is the only
            thing that can authorize, and every ambiguity is a deny. Settlement is a Rain scoped
            card that cannot come into existence without an allow.
          </p>
          <p className="mt-3 max-w-[62ch] text-[13px] leading-[1.6] text-ink-3">
            Filed from the Raingentic Commerce Hackathon, NYC. A camera watches a shelf; stock runs
            low; the agent reorders with no human in the path, and the card it spends on is scoped
            so anything outside the policy is declined by the issuer itself.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <LinkButton href="/try" variant="primary" size="lg">
              try the console
            </LinkButton>
            <LinkButton href={REPO} size="lg" external>
              read the source
            </LinkButton>
          </div>
          <p className="label mt-4">
            the console runs the whole loop in your browser on the simulated rail: no keys, no
            cards, real onchain reads.
          </p>
        </div>
        <div className="min-w-0">
          <Plate />
        </div>
      </section>

      {/* ─── the three planes ─────────────────────────────────────────────── */}
      <section className="border-t-2 border-ink pt-5">
        <h3 className="bit bit-16 text-ink">three planes, one hard boundary</h3>
        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-0 md:divide-x md:divide-dashed md:divide-paper-3">
          <article className="md:pr-5">
            <span className="bit bit-12 inline-block border-2 border-ink bg-paper-2 px-[6px] py-[5px] text-ink">
              perception
            </span>
            <p className="mt-3 text-[13px] leading-[1.6] text-ink-2">
              A camera, a price feed, a calendar: anything that can read the world. It runs in the
              browser, holds no key, and can make exactly one call: submit an observation. Swapping
              a shelf camera for a model detector changes one file and nothing downstream.
            </p>
            <p className="datum mt-3 text-[11px] text-ink-3">what it can never do: spend.</p>
          </article>
          <article className="md:px-5">
            <span className="bit bit-12 inline-block border-2 border-ink bg-ink px-[6px] py-[5px] text-ink-inv">
              policy
            </span>
            <p className="mt-3 text-[13px] leading-[1.6] text-ink-2">
              Policy.sol on Monad testnet is the mint authority: it rules on whether a spending
              instrument may be created at all. Payee allowlist, category allowlist, amount cap,
              velocity window, kill switch. Timeout, dead RPC, replayed intent, malformed answer:
              every one of them is a deny.
            </p>
            <p className="datum mt-3 text-[11px] text-ink-3">
              what only it can do: authorize. no allow, no card.
            </p>
          </article>
          <article className="md:pl-5">
            <span className="bit bit-12 inline-block border-2 border-ink bg-paper-2 px-[6px] py-[5px] text-ink">
              settlement
            </span>
            <p className="mt-3 text-[13px] leading-[1.6] text-ink-2">
              A Rain scoped card, minted per authorized intent: amount ceiling, MCC allowlist and
              expiry enforced natively by the issuer at authorization, and retired after a single
              approved use. One intent, one bounded instrument.
            </p>
            <p className="datum mt-3 text-[11px] text-ink-3">
              what it cannot do: act without an authorization.
            </p>
          </article>
        </div>
      </section>

      {/* ─── one run, as printed ──────────────────────────────────────────── */}
      <section className="mt-8 border-t-2 border-ink pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="bit bit-16 text-ink">one run, as it actually happened</h3>
          <span className="label">live rail, 2026-08-09, nobody touching anything</span>
        </div>
        <ol className="mt-4 border-2 border-ink">
          <RunRow at="01:22:54" mark="observed" weight="paper">
            bottle.stock &lt; 3, confidence 0.89. Xenova/yolos-tiny counted 0 bottles in the
            watched region.
          </RunRow>
          <RunRow at="01:22:54" mark="intent" weight="paper">
            $42.99 to Restaurant Depot, mcc 5411 grocery stores
          </RunRow>
          <RunRow at="01:22:55" mark="permitted" weight="permit">
            ruling{" "}
            <a href={`${EXPLORER}/tx/${RULING}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              0x065b210bed…0c002e4c
            </a>{" "}
            confirmed in 584 ms, block 52151814, signed by the agent&rsquo;s own key
          </RunRow>
          <RunRow at="01:22:59" mark="controls held" weight="paper">
            a probe at mcc 5813 bars and nightclubs, refused by the issuer:
            scoped_card_mcc_not_allowed. the card&rsquo;s bounds, holding.
          </RunRow>
          <RunRow at="01:23:00" mark="settled" weight="permit">
            card ••7894, transaction 971bff04…ebcd9f. Rain&rsquo;s own ledger posts the same
            $42.99 against the same transaction.
          </RunRow>
        </ol>
        <p className="mt-3 max-w-[80ch] text-[12px] leading-[1.6] text-ink-3">
          The purchase is driven through Rain&rsquo;s simulate endpoints, because a sandbox has no
          merchant terminal. Everything that moves money is Rain&rsquo;s own machinery: a real
          scoped card minted through the issuing API, an authorization ruled by Rain&rsquo;s
          decision engine, a real settlement record in Rain&rsquo;s ledger.
        </p>
      </section>

      {/* ─── the refusal ──────────────────────────────────────────────────── */}
      <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="border-2 border-ink">
          {/* The hatch carries the stamp; the prose stays on paper, where it
              can actually be read. Same split the console's record uses. */}
          <div className="field-refuse border-b-2 border-ink px-4 py-3">
            <span className="bit bit-24 text-ink">refused</span>
          </div>
          <p className="px-4 py-3 text-[13px] leading-[1.6] text-ink-2">
            Flip the onchain kill switch and the same reading mints nothing. No allow, no card, no
            possible spend, and the refusal lands on Monad as a MintRuling event anyone can open.
            Fail-closed is not a promise here; it is the default the contract boots into.
          </p>
        </div>
        <div className="border-2 border-ink px-4 py-4">
          <span className="bit bit-16 text-ink">the honest limit</span>
          <p className="mt-2 max-w-[52ch] text-[13px] leading-[1.6] text-ink-2">
            The contract is the mint authority, not a live authorization interceptor. It decides
            whether the instrument may exist; the issuer enforces the instrument&rsquo;s bounds.
            Two independent authorities, and this page will not claim the one that isn&rsquo;t
            there.
          </p>
        </div>
      </section>

      {/* ─── evidence box ─────────────────────────────────────────────────── */}
      <section className="mt-8 border-2 border-ink">
        <div className="border-b-2 border-ink bg-paper-2 px-3 py-[9px]">
          <h3 className="bit bit-16 text-ink">what is real on this page</h3>
        </div>
        <div className="px-3 py-2">
          <Fact label="the gate">
            <a href={`${EXPLORER}/address/${GATE}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {GATE.slice(0, 10)}…{GATE.slice(-6)}
            </a>
            , monad testnet 10143, verified source
          </Fact>
          <Fact label="the ruling above">
            <a href={`${EXPLORER}/tx/${RULING}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              a real transaction; open it on the explorer
            </a>
          </Fact>
          <Fact label="the card">real, minted in rain&rsquo;s sandbox at RAIL=rain</Fact>
          <Fact label="this deployment">
            the simulated rail: same loop, same contract reads, no cards
          </Fact>
          <Fact label="run the live rail">clone the repo, add your rain sandbox keys, RAIL=rain</Fact>
        </div>
      </section>

      {/* ─── close ────────────────────────────────────────────────────────── */}
      <section className="mt-10 border-t-4 border-ink pt-1">
        <div className="border-t border-ink pt-6 text-center">
          <p className="bit bit-16 text-ink">see it decide, and see it refuse</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <LinkButton href="/try" variant="primary" size="lg">
              try the console
            </LinkButton>
            <LinkButton href={REPO} size="lg" external>
              github
            </LinkButton>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-ink bg-paper-2 px-3 py-[8px]">
          <span className="label">set in silkscreen, archivo and azeret mono</span>
          <span className="label hidden sm:inline">monad testnet 10143 · rain sandbox</span>
          <span className="label">raingentic commerce hackathon, nyc</span>
        </div>
      </section>
    </div>
  );
}
