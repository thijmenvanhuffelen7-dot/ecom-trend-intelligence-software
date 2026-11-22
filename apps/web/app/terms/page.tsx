import { LegalPage } from "@/components/marketing/legal-page";

export const metadata = { title: "Voorwaarden", description: "Algemene voorwaarden van Trendscope." };

const nl = [
  { h: "De dienst", p: ["Trendscope geeft toegang tot analyses van publieke e-commercedata. Cijfers over omzet, bezoeken en verkopen van derden zijn schattingen; we garanderen niet dat ze juist of volledig zijn. Beslissingen die je op basis van de data neemt, zijn je eigen verantwoordelijkheid."] },
  { h: "Abonnementen en betaling", p: ["Abonnementen lopen per maand of per jaar en worden vooraf gefactureerd via Stripe, exclusief btw. Nieuwe workspaces krijgen een gratis proefperiode van 7 dagen. Opzeggen kan altijd in het klantportaal; je houdt toegang tot het einde van de lopende periode. Bij een mislukte betaling kunnen we de toegang na herhaalde pogingen beperken tot het gratis plan."] },
  { h: "Redelijk gebruik", p: ["Elk plan heeft limieten (zoekopdrachten, exports, AI-vragen, API-calls, leads, teamleden). Je mag de dienst niet gebruiken om data massaal door te verkopen, de limieten te omzeilen (bijvoorbeeld met meerdere gratis accounts) of de dienst te scrapen."] },
  { h: "Leads en contact met derden", p: ["Leads bevatten alleen zakelijke informatie. Als je bedrijven benadert, houd je je aan de regels voor commerciële communicatie (onder meer de Telecommunicatiewet en de AVG). Je benadert winkels via hun eigen contactkanalen."] },
  { h: "Push-to-store en inhoud", p: ["Producten die je naar je eigen winkel stuurt, worden als concept aangemaakt. Jij bent verantwoordelijk voor wat je publiceert, inclusief beelden, claims en de rechten daarop. Gebruik geen foto's of teksten van andere winkels zonder toestemming."] },
  { h: "API", p: ["API-sleutels zijn persoonlijk voor je workspace; deel ze niet. We mogen sleutels intrekken bij misbruik of een beveiligingsincident. De API is alleen-lezen en de limieten staan in de documentatie."] },
  { h: "Aansprakelijkheid", p: ["Onze aansprakelijkheid is beperkt tot het bedrag dat je in de 12 maanden vóór de schade hebt betaald, behalve bij opzet of grove nalatigheid. [Laten toetsen.]"] },
  { h: "Toepasselijk recht", p: ["Op deze voorwaarden is Nederlands recht van toepassing. [Bevoegde rechter en entiteit invullen vóór lancering.]"] },
];

const en = [
  { h: "The service", p: ["Trendscope provides analyses of public e-commerce data. Figures about third parties' revenue, visits and sales are estimates; we don't guarantee they are accurate or complete. Decisions you make based on the data are your own responsibility."] },
  { h: "Subscriptions and payment", p: ["Subscriptions are monthly or yearly and billed in advance through Stripe, excluding VAT. New workspaces get a free 7-day trial. You can cancel any time in the customer portal and keep access until the end of the current period. After repeated failed payments we may limit access to the free plan."] },
  { h: "Fair use", p: ["Every plan has limits (searches, exports, AI questions, API calls, leads, seats). You may not use the service to resell data in bulk, circumvent limits (for instance with multiple free accounts) or scrape the service."] },
  { h: "Leads and contacting third parties", p: ["Leads contain business information only. When you contact businesses, you comply with the rules for commercial communication (including ePrivacy rules and the GDPR) and use the stores' own contact channels."] },
  { h: "Push-to-store and content", p: ["Products you send to your own store are created as drafts. You are responsible for what you publish, including images, claims and the rights to them. Don't use photos or texts of other stores without permission."] },
  { h: "API", p: ["API keys are personal to your workspace; don't share them. We may revoke keys in case of abuse or a security incident. The API is read-only and its limits are listed in the documentation."] },
  { h: "Liability", p: ["Our liability is limited to the amount you paid in the 12 months before the damage, except in case of intent or gross negligence. [To be reviewed.]"] },
  { h: "Governing law", p: ["These terms are governed by Dutch law. [Fill in competent court and entity before launch.]"] },
];

export default function TermsPage() {
  return <LegalPage title="termsTitle" updated="22-11-2026" sections={{ nl, en }} />;
}
