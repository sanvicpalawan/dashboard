import { z } from "zod";
const optionalUrl = z.preprocess((value) => value === "" || value === undefined ? null : value, z.string().url().max(1000).nullable());
export const toolSchema = z.object({
  name: z.string().trim().min(2).max(120), tagline: z.string().max(200).default(""), description: z.string().max(10000).default(""),
  category: z.string().max(60).default("Automation"), status: z.enum(["active", "beta", "maintenance", "archived"]).default("active"), visibility: z.enum(["internal", "client", "public"]).default("internal"),
  repositoryUrl: optionalUrl, vercelUrl: optionalUrl, liveUrl: optionalUrl,
  builtByName: z.string().max(120).default(""), contributors: z.array(z.string().max(120)).max(30).default([]),
  language: z.string().max(60).default(""), languages: z.array(z.object({ name: z.string().max(60), percent: z.number().min(0).max(100) })).max(12).default([]),
  techStack: z.array(z.string().max(80)).max(40).default([]), ui: z.string().max(300).default(""), database: z.string().max(300).default(""), messaging: z.string().max(300).default(""), deployment: z.string().max(300).default(""),
  codeTree: z.string().max(20000).default(""), readme: z.string().max(50000).default(""),
  priceModel: z.enum(["internal", "one-time", "monthly", "setup+monthly"]).default("internal"), priceMinor: z.number().int().min(0).default(0), recurringPriceMinor: z.number().int().min(0).default(0), currency: z.string().length(3).default("PHP"),
  license: z.string().max(120).default("Proprietary"), version: z.string().max(40).default("1.0.0"), topics: z.array(z.string().max(40)).max(20).default([]),
});
export const TOOL_CATEGORIES = ["Automation", "AI agent", "Web app", "Monitoring", "Integration", "CLI", "Library", "Template", "Other"];
