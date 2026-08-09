/**
 * THE FRONT PAGE.
 *
 * The console at /try is a specimen sheet: it operates. This page is what the
 * same print shop issues when it needs to tell: a broadsheet front page.
 *
 * Its job is the argument, not the tour. A visitor who reads only the fold
 * should already know why watching is the hard part; a visitor who keeps going
 * gets the detector registry with the model ids and the download sizes, the
 * trust boundary, one real autonomous run, and the three places a refusal can
 * come from. The evidence box is last because it answers a question the rest of
 * the page has to earn first.
 *
 * Every number here is real or labelled. The run record is a live run from
 * 2026-08-09; the ruling hash resolves on the explorer.
 */

import type { ReactNode } from "react";
import { Plate } from "@/components/plate";

/** The dateline is today's, so the sheet is never a stale issue. */
export const revalidate = 3600;

const CONTRACT = `<!--
THESIS: the console's print shop issues its front page: the mechanism told as news, with the
  evidence set in boxes and the argument set before the tour. Refuses the SaaS-landing rut:
  gradient hero, icon cards, logo river, three-feature grid.
OWN-WORLD: inherited whole from the bitmap specimen (DESIGN.md): newsprint #F5F3EC, ink #0A0A0A,
  #FF5A3C only as a filled field, Silkscreen at integer steps, Archivo text, Azeret Mono data,
  square corners, 2px rules, real halftone imaging.
STORY: a visitor learns that being there is the hard part, watches a model read a shelf and
  refuse to act on one low reading, reads which models do it and what they cost, then sees one
  autonomous run and the three ways the same loop refuses.
FIRST VIEWPORT: dateline, nameplate with standing line and double rule, headline left with the
  lede and the primary action, the live halftone plate right with the detector's own boxes.
FORM: broadsheet front page, grounded candidate 6, seed key 89bfd05c.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
  verdict, and DESIGN.md
-->`;

const REPO = "https://github.com/narasim-teja/tessr";
const SDK_DOCS = `${REPO}#the-sdk`;
const VISION_DOCS = `${REPO}#the-perception-layer`;
const EXPLORER = "https://testnet.monadexplorer.com";

/**
 * The quickstart, condensed to what fits a column without lying about it.
 *
 * Every identifier here is a real export with this signature. A landing page
 * that invents a nicer API than the one that shipped is the single fastest way
 * to lose a developer, because the first thing they do is paste it.
 */
const QUICKSTART = `import { createCommerce, usd } from "@tessr/core";
import { manualSource } from "@tessr/perception";
import { monadPolicyPlane } from "@tessr/policy";
import { rainCardRail, rainClient } from "@tessr/settlement";

const payee = { id: "restaurant-depot", name: "Restaurant Depot", mcc: "5411" };

// the gate. localPolicy() is the same interface with no chain.
const policy = monadPolicyPlane({ rpcUrl, address, privateKey });

// the rail. localRainServer() answers the same api, offline.
const rail = rainCardRail({ client: rainClient({ apiKey, userId }), pem });

// perception. a camera, a price feed, a calendar: same shape.
const shelf = manualSource("shelf-cam-1");

await createCommerce({ policy, rail })
  .watch(shelf)
  .when((o) => o.signal === "bottle.stock < 3")
  .propose(() => ({ amount: usd(42.99), payee }))
  .verify((p) => suppliers.has(p.id))   // an unknown payee costs no gas
  .onResult((r) => r.ok && ship(r.receipt))
  .start();`;
const GATE = "0x8FbB75A725e9C09C0Cc1680795D90409732381cA";
const RULING = "0x50b1dde4248a1ca4d507799f13175300cfcce0c75999b9594a4e386d57df767c";
/** The agent that read the shelf on the recorded run. Links to its hub repo. */
const RUN_MODEL = "onnx-community/rfdetr_nano-ONNX";

const HUB = "https://huggingface.co";

/**
 * The detector registry, as the sheet prints it. Source: lib/detect/spec.ts.
 *
 * The model ids link to the hub repos they name. A page that claims four
 * detectors and prints four unclickable strings is asking to be taken on faith,
 * which is the one thing this surface never does.
 */
const DETECTORS = [
  {
    name: "screen",
    model: "no model",
    weights: "none",
    reads:
      "How much the watched region changed against a reference frame. It measures movement, not quantity, so it reports “not counted” rather than a number it never measured. This is the default, and it needs no network at all.",
  },
  {
    name: "objects",
    model: "Xenova/yolos-tiny",
    weights: "9 mb",
    reads:
      "Instances of one of COCO’s 80 classes. A shelf of bottles becomes a literal count, which is what turns bottle.stock < 3 into a predicate over a real number instead of a proxy for one.",
  },
  {
    name: "objects hd",
    model: "onnx-community/rfdetr_nano-ONNX",
    weights: "29 mb",
    reads:
      "The same 80 classes, read by RF-DETR nano. COCO AP 48.4 against yolos-tiny’s 28.7, which on a crowded shelf under bad light is the difference between counting the bottles and counting some of them.",
  },
  {
    name: "open vocabulary",
    model: "Xenova/owlvit-base-patch32",
    weights: "148 mb",
    reads:
      "Any phrase you type. No class list and no training, so the answer to “what if the thing on the shelf is not a bottle” is to type what it is. It costs the most and it is the slowest, and it exists to prove the seam is a seam.",
  },
];

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

/** A claim in the argument: the assertion struck in ink, then the reasoning. */
function Claim({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="grid grid-cols-1 gap-x-8 gap-y-2 border-b border-dashed border-paper-3 py-5 last:border-b-0 md:grid-cols-[228px_1fr]">
      <h4 className="bit bit-12 leading-[1.4] text-ink md:pt-[2px]">{title}</h4>
      <p className="max-w-[76ch] text-[14px] leading-[1.65] text-ink-2">{children}</p>
    </article>
  );
}

/** One row of the detector registry. Stacks under md, tabulates above it. */
function DetectorRow({
  name,
  model,
  weights,
  reads,
}: {
  name: string;
  model: string;
  weights: string;
  reads: string;
}) {
  const hub = model.includes("/");
  return (
    <div className="border-b border-dashed border-paper-3 px-3 py-[13px] last:border-b-0 md:grid md:grid-cols-[118px_236px_58px_1fr] md:items-baseline md:gap-4">
      <span className="bit bit-12 block text-ink">{name}</span>
      <span className="datum mt-[7px] flex items-baseline justify-between gap-3 text-[11px] text-ink-2 md:mt-0 md:block">
        {hub ? (
          <a
            href={`${HUB}/${model}`}
            target="_blank"
            rel="noreferrer"
            className="break-all underline underline-offset-2 hover:bg-signal hover:text-ink hover:no-underline"
          >
            {model}
          </a>
        ) : (
          <span className="break-all">{model}</span>
        )}
        {/* Under md there is no column for the weight, so it rides the model
            line rather than taking a line of its own to say "9 mb". */}
        <span className="shrink-0 text-ink-3 md:hidden">{weights}</span>
      </span>
      <span className="datum hidden text-[11px] text-ink-3 md:block">{weights}</span>
      <p className="mt-[8px] max-w-[72ch] text-[13px] leading-[1.6] text-ink-2 md:mt-0">{reads}</p>
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

/**
 * The quickstart, set as code.
 *
 * Comments drop to the quiet ink so the call chain is what the eye lands on.
 * Split rather than highlighted: this world has one accent and it belongs to a
 * ruling, not to a keyword.
 */
function Code({ source }: { source: string }) {
  return (
    <pre className="datum overflow-x-auto px-3 py-3 text-[11px] leading-[1.7] text-ink">
      <code>
        {source.split("\n").map((line, i) => {
          const at = line.indexOf("//");
          return (
            <span key={i} className="block">
              {at === -1 ? (
                line || " "
              ) : (
                <>
                  {line.slice(0, at)}
                  <span className="text-ink-3">{line.slice(at)}</span>
                </>
              )}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

/** A swap point: what ships offline, and what it becomes in production. */
function Swap({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 border-b border-dashed border-paper-3 py-[7px] last:border-b-0">
      <span className="datum text-[11px] text-ink-3">{from}</span>
      <span className="bit bit-8 text-ink-3" aria-label="becomes">
        &gt;&gt;
      </span>
      <span className="datum text-[11px] text-ink">{to}</span>
    </div>
  );
}

/** One of the three refusals, and who does the refusing. */
function Refusal({ mark, who, children }: { mark: string; who: string; children: ReactNode }) {
  return (
    <article className="px-4 py-4">
      <span className="bit bit-12 inline-block border-2 border-ink bg-paper-2 px-[6px] py-[5px] text-ink">
        {mark}
      </span>
      <p className="mt-3 text-[13px] leading-[1.6] text-ink-2">{children}</p>
      <p className="datum mt-3 text-[11px] text-ink-3">refused by {who}</p>
    </article>
  );
}

export default function FrontPage() {
  const dateline = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  })
    .format(new Date())
    .toLowerCase();

  return (
    <div className="mx-auto max-w-[1120px] px-4 pb-10 lg:px-6">
      <div hidden aria-hidden dangerouslySetInnerHTML={{ __html: CONTRACT }} />

      {/* ─── dateline ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-ink py-[8px]">
        <span className="label">{dateline}</span>
        <span className="label hidden sm:inline">monad testnet edition</span>
        <span className="label">price: bounded</span>
      </div>

      {/* ─── nameplate ────────────────────────────────────────────────────── */}
      <header className="py-6">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div className="flex items-center gap-4">
            {/* The mark, printed as the plate version: ink block, paper aperture. */}
            <img
              src="/logo.svg"
              alt=""
              className="size-11 shrink-0 border-2 border-ink sm:size-14"
            />
            <h1 className="bit bit-32 sm:bit-48 text-ink">tessr</h1>
          </div>
          <nav className="flex items-center gap-2">
            <LinkButton href="/try">try the console</LinkButton>
            <LinkButton href={REPO} external>
              github
            </LinkButton>
          </nav>
        </div>
        {/* The standing line, where a broadsheet keeps its slogan. */}
        <p className="bit bit-8 sm:bit-12 mt-4 w-fit bg-ink px-2 py-[6px] text-ink-inv">
          the perception layer for agentic commerce
        </p>
      </header>

      {/* The broadsheet's double rule. */}
      <div className="border-b-4 border-ink" />
      <div className="mt-[3px] border-b border-ink" />

      {/* ─── the fold ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 py-7 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
        <div className="flex min-w-0 flex-col">
          {/* Three beats, one per plane, held as three lines at every width so
              the rhythm never depends on where the column happens to wrap. */}
          <h2 className="bit bit-16 sm:bit-24 lg:bit-32 leading-[1.35] text-ink">
            <span className="block">it keeps watching.</span>
            <span className="block">the chain decides.</span>
            <span className="block">the money moves.</span>
          </h2>
          <p className="mt-5 max-w-[64ch] text-[15px] leading-[1.65] text-ink-2">
            An agent can already decide to buy. What it cannot do is be there: watching a real
            scene, hour after hour, for the one minute the condition becomes true. Tessr is that
            layer. A vision model reads the frame locally, counts what is actually on the shelf,
            and when the count crosses the line it proposes a payment. Proposing is the whole of
            what perception is allowed to do.
          </p>
          <p className="mt-4 max-w-[64ch] text-[15px] leading-[1.65] text-ink-2">
            The authority sits where perception cannot reach it. A contract on Monad rules on every
            proposal, and a card comes into existence only if it allows one. A timeout, a dead RPC,
            a replayed intent, a kill switch: every one of them is a deny. The card that does get
            minted is scoped to one amount, one merchant category and one use, and the issuer
            enforces those bounds itself.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <LinkButton href="/try" variant="primary" size="lg">
              try the console
            </LinkButton>
            <LinkButton href={REPO} size="lg" external>
              read the source
            </LinkButton>
          </div>
          <p className="label mt-4 leading-[1.5]">
            the console runs the whole loop in your browser: real detectors, real contract reads on
            monad testnet, no keys and no cards.
          </p>
        </div>
        <div className="min-w-0">
          <Plate />
        </div>
      </section>

      {/* ─── the argument ─────────────────────────────────────────────────── */}
      <section className="mt-4 border-t-2 border-ink pt-6">
        <h3 className="bit bit-16 text-ink">why this is not a payments feature</h3>
        <div className="mt-2">
          <Claim title="being there is the hard part">
            Nearly every agent-commerce project starts after something has already decided to buy,
            and treats the payment as the problem. The payment is the easy half. The expensive half
            is presence: being on the scene at the minute the world changes, which is precisely
            what a human operator cannot do and a checkout API was never asked to. Tessr is the
            half nobody is building. A model reads a real scene continuously, for as long as you
            leave it running, with nobody in the room.
          </Claim>
          <Claim title="the model runs on your machine">
            Every detector runs in the browser. No frame, no crop and no embedding leaves the
            machine, there is no per-inference bill, and there is no network round trip inside the
            moment you are trying to catch. A hosted vision model was costed out and rejected for
            that last reason rather than for the price: putting someone else’s uptime in the
            opening beat of a continuous loop is not sustained perception, it is a subscription to
            it.
          </Claim>
          <Claim title="the bound is minted, not monitored">
            This is not a shared card with a spending policy watching it and an alert after the
            fact. One intent gets one card, created only after an onchain allow, with the amount
            ceiling, the merchant category and the expiry enforced by the issuer at authorization,
            and the card retired after a single approved use. The bound exists before the money can
            move, which is the only time a bound is worth anything.
          </Claim>
        </div>
        <p className="mt-5 max-w-[86ch] text-[14px] leading-[1.65] text-ink">
          Each of these exists somewhere on its own. The chain of all three, with a hard boundary
          between the thing that sees and the thing that spends, is the product.
        </p>
      </section>

      {/* ─── the detectors ────────────────────────────────────────────────── */}
      <section className="mt-10 border-t-2 border-ink pt-6">
        <h3 className="bit bit-16 text-ink">what the machine actually sees</h3>
        <p className="mt-4 max-w-[86ch] text-[14px] leading-[1.65] text-ink-2">
          A frame is reduced to a luminance grid twelve times a second and diffed against a
          reference. That costs a fraction of a millisecond, and it decides exactly one thing:
          whether an inference is worth spending. When one is, the watched region is cropped at
          source resolution and handed to a detector running in a Web Worker, which returns a count
          and a set of boxes. Four consecutive low counts, never one, emit the observation. That
          last rule is the difference between a system that survives a hand passing the lens and
          one that buys groceries because of it.
        </p>

        <div className="mt-5 border-2 border-ink">
          <div className="hidden border-b-2 border-ink bg-paper-2 px-3 py-[10px] md:grid md:grid-cols-[118px_236px_58px_1fr] md:gap-4">
            <span className="label">detector</span>
            <span className="label">model</span>
            <span className="label">weights</span>
            <span className="label">what it reads</span>
          </div>
          {DETECTORS.map((detector) => (
            <DetectorRow key={detector.name} {...detector} />
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10">
          <p className="max-w-[72ch] text-[14px] leading-[1.65] text-ink-2">
            All four are swappable at runtime, and all four produce an identical observation. The
            route handler, the pipeline, the intent derivation, the Monad gate and the card rail
            are byte for byte unchanged across a swap. If any of them could tell which detector
            ran, the perception layer would be decoration rather than a layer, so this is the
            property worth demonstrating and the reason the model-free detector was kept rather
            than replaced.
          </p>
          <p className="max-w-[72ch] text-[14px] leading-[1.65] text-ink-2">
            Weights come from the Hugging Face CDN once and are cached by the browser, quantised to
            q8 because 584 MB and 148 MB are different questions on conference wifi. WebGPU where
            it exists, WASM where it does not, and an eight second watchdog for the third case: a
            driver that hands out an adapter, accepts the work and never answers. That one is not
            hypothetical, and the fallback is why it now degrades loudly instead of hanging.
          </p>
        </div>
      </section>

      {/* ─── the three planes ─────────────────────────────────────────────── */}
      <section className="mt-10 border-t-2 border-ink pt-6">
        <h3 className="bit bit-16 text-ink">three planes, one hard boundary</h3>
        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-0 md:divide-x md:divide-dashed md:divide-paper-3">
          <article className="md:pr-5">
            <span className="bit bit-12 inline-block border-2 border-ink bg-paper-2 px-[6px] py-[5px] text-ink">
              perception
            </span>
            <p className="mt-3 text-[13px] leading-[1.6] text-ink-2">
              A camera, a price feed, a calendar: anything that can read the world. It runs in the
              browser, holds no key, and can make exactly one call, carrying no amount, no payee
              and no card id. A compromised client can misreport the world. It cannot change what
              that report is worth.
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
              A scoped card, minted per authorized intent: amount ceiling, merchant category
              allowlist and expiry enforced natively by the issuer at authorization, and retired
              after a single approved use. One intent, one bounded instrument.
            </p>
            <p className="datum mt-3 text-[11px] text-ink-3">
              what it cannot do: act without an authorization.
            </p>
          </article>
        </div>
      </section>

      {/* ─── the sdk ──────────────────────────────────────────────────────── */}
      <section className="mt-10 border-t-2 border-ink pt-6">
        <h3 className="bit bit-16 text-ink">wire it into your own agent</h3>
        <p className="mt-4 max-w-[86ch] text-[14px] leading-[1.65] text-ink-2">
          Tessr is four packages and one chain. You bring a source, a predicate and a proposal;
          the SDK owns the order they run in. Everything below runs on your machine with no env
          vars, no network, no chain and no cards, and every plane in it is the swappable one.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr] lg:gap-8">
          <div className="min-w-0 border-2 border-ink">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b-2 border-ink bg-paper-2 px-3 py-[9px]">
              <span className="bit bit-12 text-ink">examples/quickstart.ts</span>
              <span className="label">bun run example</span>
            </div>
            <Code source={QUICKSTART} />
          </div>

          <div className="min-w-0">
            <div className="border-2 border-ink">
              <div className="border-b-2 border-ink bg-paper-2 px-3 py-[9px]">
                <h4 className="bit bit-12 text-ink">the ordering is the product</h4>
              </div>
              <p className="px-3 py-3 text-[13px] leading-[1.6] text-ink-2">
                <span className="datum text-[11px] text-ink">verify</span> runs before the gate,
                so an unknown payee never reaches the chain and never costs gas.{" "}
                <span className="datum text-[11px] text-ink">authorize</span> runs before{" "}
                <span className="datum text-[11px] text-ink">settle</span>, and settle takes the
                authorization as an argument, which makes calling it without one a type error
                rather than a policy you have to remember.
              </p>
            </div>

            <div className="mt-4 border-2 border-ink">
              <div className="border-b-2 border-ink bg-paper-2 px-3 py-[9px]">
                <h4 className="bit bit-12 text-ink">swap any plane</h4>
              </div>
              <div className="px-3 py-2">
                <Swap from="manualSource" to="your own source" />
                <Swap from="localPolicy" to="monadPolicyPlane" />
                <Swap from="localRainServer" to="the rain sandbox" />
              </div>
            </div>

            <div className="mt-4">
              <LinkButton href={SDK_DOCS} external>
                read the sdk reference
              </LinkButton>
            </div>
          </div>
        </div>
      </section>

      {/* ─── one run, as printed ──────────────────────────────────────────── */}
      <section className="mt-10 border-t-2 border-ink pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="bit bit-16 text-ink">one run, nobody touching anything</h3>
          <span className="label">live rail, 2026-08-09</span>
        </div>
        <p className="mt-4 max-w-[86ch] text-[14px] leading-[1.65] text-ink-2">
          The console has an arm control. Arm it and walk away: four consecutive low readings fire
          the loop with nobody pressing anything. This is one of those runs, printed the way the
          console printed it.
        </p>
        <ol className="mt-4 border-2 border-ink">
          <RunRow at="10:56:18" mark="observed" weight="paper">
            cup.stock &lt; 2, confidence 0.79.{" "}
            <a
              href={`${HUB}/${RUN_MODEL}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {RUN_MODEL}
            </a>{" "}
            counted 1 cup in the watched region at score &gt;= 0.30, in 904 ms.
          </RunRow>
          <RunRow at="10:56:18" mark="intent" weight="paper">
            $42.99 to Restaurant Depot, mcc 5411 grocery stores
          </RunRow>
          <RunRow at="10:56:18" mark="permitted" weight="permit">
            ruling{" "}
            <a
              href={`${EXPLORER}/tx/${RULING}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              0x50b1dde424…57df767c
            </a>{" "}
            confirmed in 363 ms, block 52264466, signed by the agent&rsquo;s own key
          </RunRow>
          <RunRow at="10:56:22" mark="bounds held" weight="paper">
            a probe at mcc 5813 bars and nightclubs, refused by the issuer:
            scoped_card_mcc_not_allowed. the card&rsquo;s bounds, holding.
          </RunRow>
          <RunRow at="10:56:23" mark="settled" weight="permit">
            card ••5735, transaction 3ef1154b…3953d9. Rain&rsquo;s own ledger posts the same
            $42.99 against the same transaction, completed.
          </RunRow>
        </ol>
        <p className="mt-3 max-w-[86ch] text-[12px] leading-[1.6] text-ink-3">
          Nothing on the money side is mocked. The card was minted through Rain&rsquo;s issuing
          API, the authorization was ruled by Rain&rsquo;s decision engine, and the settlement is a
          record in Rain&rsquo;s own ledger, checked back against ours. The purchase is driven
          through Rain&rsquo;s simulate endpoints because a sandbox has no merchant terminal, and
          the sandbox is where this runs. No real funds exist anywhere in this project.
        </p>
      </section>

      {/* ─── the refusals ─────────────────────────────────────────────────── */}
      <section className="mt-10 border-2 border-ink">
        {/* The hatch carries the heading; the prose stays on paper, where it can
            actually be read. Same split the console's record uses. */}
        <div className="field-refuse border-b-2 border-ink px-4 py-3">
          <h3 className="bit bit-24 text-ink">three ways it refuses</h3>
        </div>
        <div className="grid grid-cols-1 divide-y divide-dashed divide-paper-3 md:grid-cols-3 md:divide-x md:divide-y-0">
          <Refusal mark="kill switch" who="the contract, before a card can exist">
            Flipped on chain, and the same reading mints nothing. No allow, no card, no possible
            spend. The refusal itself lands on Monad as a MintRuling event that anyone can open.
            Fail-closed is not a promise here, it is the state the contract boots into.
          </Refusal>
          <Refusal mark="payee not allowed" who="the contract, at zero gas">
            The supplier is not on the onchain allowlist. A free contract read catches that before
            any write is attempted, so the deny costs nothing and still leaves the same record. The
            cheapest refusal is the one that never touches the chain.
          </Refusal>
          <Refusal mark="wrong category" who="the issuer, at authorization time">
            The card exists and the authorization is declined anyway, because MCC 5813 was never
            on it. scoped_card_mcc_not_allowed, in the issuer&rsquo;s own ledger, with our own
            receipt saying the same thing from the other side.
          </Refusal>
        </div>
        <div className="border-t-2 border-ink bg-paper-2 px-4 py-4">
          <p className="max-w-[92ch] text-[13px] leading-[1.65] text-ink-2">
            Two authorities, independent on purpose. The contract decides whether the card may
            exist. The issuer decides what the card may do. Tessr does not claim to intercept a
            live card authorization, because it does not, and on a page like this that is the
            easiest claim in the world to disprove.
          </p>
        </div>
      </section>

      {/* ─── evidence box ─────────────────────────────────────────────────── */}
      <section className="mt-10 border-2 border-ink">
        <div className="border-b-2 border-ink bg-paper-2 px-3 py-[9px]">
          <h3 className="bit bit-16 text-ink">what is real on this page</h3>
        </div>
        <div className="px-3 py-2">
          <Fact label="the gate">
            <a
              href={`${EXPLORER}/address/${GATE}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {GATE.slice(0, 10)}…{GATE.slice(-6)}
            </a>
            , monad testnet 10143, verified source
          </Fact>
          <Fact label="the ruling above">
            <a
              href={`${EXPLORER}/tx/${RULING}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              a real transaction; open it on the explorer
            </a>
          </Fact>
          <Fact label="the detectors">
            <a
              href={VISION_DOCS}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              four published models
            </a>
            , run in your browser, nothing uploaded
          </Fact>
          <Fact label="the sdk">
            <a
              href={SDK_DOCS}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              the api the code above actually exports
            </a>
          </Fact>
          <Fact label="the card">real, minted in rain&rsquo;s sandbox at RAIL=rain</Fact>
          <Fact label="this deployment">
            the local rail: same loop, same contract reads, no cards minted
          </Fact>
          <Fact label="run the live rail">
            clone the repo, add your rain sandbox keys, RAIL=rain
          </Fact>
        </div>
      </section>

      {/* ─── close ────────────────────────────────────────────────────────── */}
      <section className="mt-10 border-t-4 border-ink pt-1">
        <div className="border-t border-ink pt-8 text-center">
          <p className="bit bit-16 sm:bit-24 text-ink">see it decide, and see it refuse</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <LinkButton href="/try" variant="primary" size="lg">
              try the console
            </LinkButton>
            <LinkButton href={SDK_DOCS} size="lg" external>
              read the sdk reference
            </LinkButton>
            <LinkButton href={REPO} size="lg" external>
              github
            </LinkButton>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-ink bg-paper-2 px-3 py-[8px]">
          <span className="label">built in new york</span>
          <span className="label hidden sm:inline">monad testnet 10143 · rain sandbox</span>
          <span className="label">no real funds anywhere</span>
        </div>
      </section>
    </div>
  );
}
