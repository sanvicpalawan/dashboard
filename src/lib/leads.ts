export const STAGES = ["new", "contacted", "pitched", "negotiating", "won", "declined", "no_response"] as const;
export const CHANNELS = ["email", "whatsapp", "call", "meeting", "in_person", "instagram", "facebook", "linkedin", "other"] as const;
export const OUTCOMES = ["pending", "positive", "neutral", "declined", "no_response", "won"] as const;
export const SERVICE_OPTIONS = ["Website", "Website redesign", "Web application", "E-commerce website", "Booking website", "AI inquiry agent", "AI product assistant", "WhatsApp automation", "Appointment automation", "Business automation", "Social media management", "Hosting & maintenance", "White-label software", "Recurring support"];

// Stage slugs are kept stable for existing records. They map to the pipeline as:
// new → new lead, contacted → contacted, pitched → proposal sent, negotiating → qualified/negotiating,
// won → won, declined → lost, no_response → lost (no answer).
export const STAGE_LABELS: Record<string, string> = { new: "New", contacted: "Contacted", pitched: "Pitched", negotiating: "Negotiating", won: "Won", declined: "Declined", no_response: "No response" };

/** Verified means the business and contact details were confirmed with the business itself, not inferred. */
export const VERIFICATIONS = ["unverified", "partial", "verified"] as const;
export const VERIFICATION_LABELS: Record<string, string> = { unverified: "Unverified contact data", partial: "Partly verified", verified: "Verified with business" };
