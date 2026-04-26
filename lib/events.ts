import {
  AlertTriangle,
  BadgeCheck,
  CircleDot,
  FileText,
  Scale,
  type LucideIcon,
} from "lucide-react";

export type SpectrumBucket = "left" | "center" | "right";

export type SourceType =
  | "wire"
  | "mainstream"
  | "partisan"
  | "local"
  | "opinion-heavy"
  | "policy";

export type EventSource = {
  id: string;
  outlet: string;
  title: string;
  url: string;
  publishedAt: string;
  bucket: SpectrumBucket;
  rating: string;
  type: SourceType;
  frame: string;
};

export type SpectrumAnalysis = {
  bucket: SpectrumBucket;
  label: string;
  summary: string;
  emphasis: string[];
  language: string[];
  sourceIds: string[];
};

export type NewsEvent = {
  slug: string;
  title: string;
  topic: string;
  status: "monitoring" | "developing" | "settled";
  updatedAt: string;
  summary: string;
  confidence: number;
  divergence: number;
  sourceCount: number;
  timespan: string;
  sharedFacts: string[];
  disputedOrVariable: string[];
  spectrum: SpectrumAnalysis[];
  sources: EventSource[];
};

export const bucketLabels: Record<SpectrumBucket, string> = {
  left: "Left",
  center: "Center",
  right: "Right",
};

export const bucketClasses: Record<SpectrumBucket, string> = {
  left: "bucketLeft",
  center: "bucketCenter",
  right: "bucketRight",
};

export const signalIcons: Record<string, LucideIcon> = {
  facts: BadgeCheck,
  friction: AlertTriangle,
  frames: Scale,
  sources: FileText,
  status: CircleDot,
};

export const events: NewsEvent[] = [
  {
    slug: "sample-border-funding-negotiations",
    title: "Border funding negotiations become proxy fight over executive authority",
    topic: "Immigration",
    status: "developing",
    updatedAt: "Prototype seed",
    summary:
      "Coverage broadly agrees that lawmakers are negotiating enforcement funding and asylum-processing changes. The largest split is whether the story is framed as an operational capacity problem, a humanitarian failure, or a test of presidential authority.",
    confidence: 82,
    divergence: 74,
    sourceCount: 46,
    timespan: "Last 18 hours",
    sharedFacts: [
      "Congressional negotiators are discussing a package that includes border enforcement funds and asylum-processing changes.",
      "Administration officials argue existing capacity is insufficient for current migration levels.",
      "Opponents in both parties have criticized portions of the package, but for different stated reasons.",
      "Several state officials are using the negotiations to renew arguments about federal versus state authority.",
    ],
    disputedOrVariable: [
      "Whether the proposal represents a meaningful enforcement increase or a symbolic political compromise.",
      "Whether humanitarian processing delays are caused primarily by underfunding, policy incentives, or court backlogs.",
      "Whether state-level enforcement actions are legitimate pressure tactics or unconstitutional interference.",
    ],
    spectrum: [
      {
        bucket: "left",
        label: "Capacity and humanitarian burden",
        summary:
          "Left-leaning coverage tends to emphasize asylum bottlenecks, legal obligations, and the operational strain on cities and aid groups. It often treats enforcement-only proposals as incomplete without court staffing and processing infrastructure.",
        emphasis: [
          "Processing delays",
          "Local service strain",
          "Legal asylum obligations",
        ],
        language: ["humanitarian", "backlog", "due process"],
        sourceIds: ["border-left-1", "border-left-2"],
      },
      {
        bucket: "center",
        label: "Negotiation mechanics",
        summary:
          "Center coverage focuses on vote counts, funding lines, and the difficulty of aligning Congress, federal agencies, and states. It is more likely to separate what is in the proposal from campaign rhetoric around it.",
        emphasis: ["Legislative details", "Agency capacity", "Vote math"],
        language: ["package", "negotiators", "implementation"],
        sourceIds: ["border-center-1", "border-center-2"],
      },
      {
        bucket: "right",
        label: "Enforcement and sovereignty",
        summary:
          "Right-leaning coverage tends to frame the story around illegal crossings, deterrence, and executive failure. Partisan outlets often describe the proposal through whether it restores control or gives political cover to the administration.",
        emphasis: ["Illegal crossings", "Deterrence", "State authority"],
        language: ["border crisis", "sovereignty", "enforcement"],
        sourceIds: ["border-right-1", "border-right-2"],
      },
    ],
    sources: [
      {
        id: "border-left-1",
        outlet: "Example Progressive Daily",
        title: "Aid groups warn border talks ignore asylum processing backlog",
        url: "https://example.com/source-border-left-1",
        publishedAt: "08:20",
        bucket: "left",
        rating: "Lean Left",
        type: "partisan",
        frame: "Humanitarian capacity",
      },
      {
        id: "border-left-2",
        outlet: "Example Metro News",
        title: "Cities ask Congress for funds as migrant services strain budgets",
        url: "https://example.com/source-border-left-2",
        publishedAt: "09:45",
        bucket: "left",
        rating: "Lean Left",
        type: "local",
        frame: "Local service pressure",
      },
      {
        id: "border-center-1",
        outlet: "Example Wire",
        title: "Negotiators weigh border enforcement funds in spending talks",
        url: "https://example.com/source-border-center-1",
        publishedAt: "10:10",
        bucket: "center",
        rating: "Center",
        type: "wire",
        frame: "Legislative process",
      },
      {
        id: "border-center-2",
        outlet: "Example Policy Review",
        title: "What is inside the latest border funding proposal",
        url: "https://example.com/source-border-center-2",
        publishedAt: "11:05",
        bucket: "center",
        rating: "Center",
        type: "policy",
        frame: "Policy mechanics",
      },
      {
        id: "border-right-1",
        outlet: "Example Conservative Journal",
        title: "Governors press Washington as border enforcement fight escalates",
        url: "https://example.com/source-border-right-1",
        publishedAt: "11:30",
        bucket: "right",
        rating: "Right",
        type: "partisan",
        frame: "State authority",
      },
      {
        id: "border-right-2",
        outlet: "Example National Desk",
        title: "Republicans say proposal fails to restore border deterrence",
        url: "https://example.com/source-border-right-2",
        publishedAt: "12:15",
        bucket: "right",
        rating: "Lean Right",
        type: "mainstream",
        frame: "Enforcement test",
      },
    ],
  },
  {
    slug: "sample-campus-speech-hearing",
    title: "Campus speech hearing splits coverage between safety, rights, and political theater",
    topic: "Education",
    status: "monitoring",
    updatedAt: "Prototype seed",
    summary:
      "Sources agree that university leaders faced congressional questioning over campus protest policies. The divide is whether the hearing is mainly about student safety, free expression, antisemitism and discrimination, or partisan spectacle.",
    confidence: 78,
    divergence: 68,
    sourceCount: 33,
    timespan: "Last 26 hours",
    sharedFacts: [
      "University officials testified before lawmakers about campus protest and speech policies.",
      "Members of both parties questioned how schools enforce conduct rules while protecting expression.",
      "Student groups and civil liberties advocates released competing statements after the hearing.",
    ],
    disputedOrVariable: [
      "Whether administrators are under-enforcing rules or over-correcting in response to political pressure.",
      "Whether the hearing produced new accountability or mostly repeated existing partisan arguments.",
    ],
    spectrum: [
      {
        bucket: "left",
        label: "Civil liberties and minority safety",
        summary:
          "Left coverage emphasizes protecting speech while preventing harassment, with attention to Muslim, Arab, Jewish, and activist student experiences. Some stories warn that congressional pressure may chill lawful protest.",
        emphasis: ["Student rights", "Selective enforcement", "Civil liberties"],
        language: ["chilling effect", "protected speech", "campus climate"],
        sourceIds: ["campus-left-1"],
      },
      {
        bucket: "center",
        label: "Institutional governance",
        summary:
          "Center coverage highlights university policy, disciplinary procedures, and the questions officials could or could not answer. It generally treats the hearing as a governance and accountability story.",
        emphasis: ["Policy enforcement", "Testimony", "Governance"],
        language: ["hearing", "disciplinary process", "oversight"],
        sourceIds: ["campus-center-1"],
      },
      {
        bucket: "right",
        label: "Ideological double standard",
        summary:
          "Right coverage commonly frames the event as proof that elite universities tolerate intimidation when it comes from favored political groups. Opinion-heavy sources make broader claims about ideological capture.",
        emphasis: ["Double standards", "Campus ideology", "Donor pressure"],
        language: ["elite institutions", "accountability", "antisemitism"],
        sourceIds: ["campus-right-1"],
      },
    ],
    sources: [
      {
        id: "campus-left-1",
        outlet: "Example Civil Rights Monitor",
        title: "Advocates warn campus speech crackdown could chill protest",
        url: "https://example.com/source-campus-left-1",
        publishedAt: "14:05",
        bucket: "left",
        rating: "Left",
        type: "policy",
        frame: "Civil liberties",
      },
      {
        id: "campus-center-1",
        outlet: "Example Wire",
        title: "University leaders questioned by lawmakers over protest policies",
        url: "https://example.com/source-campus-center-1",
        publishedAt: "14:40",
        bucket: "center",
        rating: "Center",
        type: "wire",
        frame: "Oversight",
      },
      {
        id: "campus-right-1",
        outlet: "Example Opinion Review",
        title: "Hearing exposes double standard in campus speech rules",
        url: "https://example.com/source-campus-right-1",
        publishedAt: "15:10",
        bucket: "right",
        rating: "Right",
        type: "opinion-heavy",
        frame: "Institutional bias",
      },
    ],
  },
];

export function getEvent(slug: string) {
  return events.find((event) => event.slug === slug);
}

export function getBucketSources(event: NewsEvent, bucket: SpectrumBucket) {
  return event.sources.filter((source) => source.bucket === bucket);
}
