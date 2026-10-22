export const STAGES = ["new", "contacted", "pitched", "negotiating", "won", "declined", "no_response"] as const;
export const CHANNELS = ["email", "whatsapp", "call", "meeting", "in_person", "instagram", "facebook", "linkedin", "other"] as const;
export const OUTCOMES = ["pending", "positive", "neutral", "declined", "no_response", "won"] as const;
export const SERVICE_OPTIONS = ["Website", "Website redesign", "Web application", "E-commerce website", "Booking website", "AI inquiry agent", "AI product assistant", "WhatsApp automation", "Appointment automation", "Business automation", "Social media management", "Hosting & maintenance", "White-label software", "Recurring support"];
export const STAGE_LABELS: Record<string, string> = { new: "New", contacted: "Contacted", pitched: "Pitched", negotiating: "Negotiating", won: "Won", declined: "Declined", no_response: "No response" };
