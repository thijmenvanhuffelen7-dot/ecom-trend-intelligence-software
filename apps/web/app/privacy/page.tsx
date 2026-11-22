import { LegalPage } from "@/components/marketing/legal-page";

export const metadata = { title: "Privacy", description: "Hoe Trendscope met persoonsgegevens en data over webshops omgaat." };

const nl = [
  { h: "Wie zijn wij", p: ["Trendscope (werknaam) levert een platform voor trend- en concurrentie-intelligentie voor e-commerce. Voor vragen over privacy: privacy@trendscope.example. [Juridische entiteit, adres en KvK-nummer invullen vóór lancering.]"] },
  {
    h: "Gegevens van onze gebruikers",
    p: [
      "Account: e-mailadres, naam (optioneel), taal- en weergavevoorkeuren, en het lidmaatschap van workspaces.",
      "Gebruik: zoekopdrachten, filters, watchlists, alertregels en tellers voor de limieten van je plan; een audit log van beheeracties (bv. uitnodigingen, API-sleutels, exports).",
      "Betalingen lopen via Stripe; wij ontvangen geen kaartgegevens, alleen de status van je abonnement en je facturen.",
      "Vragen aan de AI-assistent en de antwoorden bewaren we per workspace, zodat je eerdere gesprekken terugvindt.",
      "API-sleutels en uitnodigingstokens bewaren we alleen als hash; tokens van gekoppelde winkels versleuteld (AES-256-GCM).",
    ],
  },
  { h: "Grondslag en doel", p: ["Uitvoering van de overeenkomst (het leveren van de dienst, facturatie) en gerechtvaardigd belang (beveiliging, misbruikpreventie, verbetering van de dienst). Marketingmail sturen we alleen met toestemming; de digest met alerts stel je zelf in en uit."] },
  {
    h: "Data over webshops, advertenties en creators",
    p: [
      "Het platform bevat informatie over webshops (domein, producten, prijzen, technologie), advertenties uit officiële advertentiebibliotheken en publieke creatorprofielen. Dit is overwegend bedrijfsinformatie.",
      "We verzamelen geen gegevens over klanten van webshops. Van creators verwerken we alleen publieke, zakelijke gegevens (handle, volgers, publieke video's), op basis van gerechtvaardigd belang. Gebruikersnamen van Reddit slaan we niet op.",
      "Omzet, bezoeken en verkopen van derden zijn schattingen en worden zo gelabeld.",
      "Bezwaar of verwijdering (bijvoorbeeld als eenmanszaak of creator): mail privacy@trendscope.example met de URL of handle; we reageren binnen 30 dagen.",
    ],
  },
  {
    h: "Verwerkers",
    p: [
      "Hosting en databases (EU-regio), Stripe (betalingen), Resend (transactionele e-mail), Anthropic (AI-functies; alleen de vraag en de benodigde platformdata, niet voor training), en optioneel Clerk (inloggen). Met elke verwerker is een verwerkersovereenkomst gesloten. [Lijst en regio's controleren vóór lancering.]",
    ],
  },
  { h: "Bewaartermijnen", p: ["Accountgegevens zolang je account bestaat en tot 30 dagen daarna. Facturen 7 jaar (fiscale bewaarplicht). Audit logs 1 jaar. AI-gesprekken tot je ze verwijdert of je workspace opheft."] },
  { h: "Je rechten", p: ["Je hebt recht op inzage, correctie, verwijdering, beperking, overdraagbaarheid en bezwaar. Je kunt ook een klacht indienen bij de Autoriteit Persoonsgegevens."] },
  { h: "Cookies", p: ["We gebruiken alleen functionele cookies: je sessie, je taal en thema, en de gekozen workspace. Geen advertentie- of trackingcookies."] },
  { h: "Chrome-extensie", p: ["De extensie leest geen pagina-inhoud. Alleen de hostnaam van het actieve tabblad gaat naar je eigen Trendscope-omgeving, en alleen als je de badge hebt aangezet. Je API-sleutel blijft lokaal in je browser."] },
];

const en = [
  { h: "Who we are", p: ["Trendscope (working name) provides a trend and competitive-intelligence platform for e-commerce. Privacy questions: privacy@trendscope.example. [Fill in legal entity, address and company number before launch.]"] },
  {
    h: "Data about our users",
    p: [
      "Account: email address, name (optional), language and display preferences, and workspace memberships.",
      "Usage: searches, filters, watchlists, alert rules and counters for your plan's limits; an audit log of admin actions (e.g. invitations, API keys, exports).",
      "Payments run through Stripe; we never receive card details, only your subscription status and invoices.",
      "Questions to the AI assistant and its answers are stored per workspace so you can find earlier conversations.",
      "API keys and invitation tokens are stored only as hashes; tokens of connected stores are encrypted (AES-256-GCM).",
    ],
  },
  { h: "Legal basis and purpose", p: ["Performance of the contract (providing the service, billing) and legitimate interest (security, abuse prevention, improving the service). Marketing email only with consent; you control the alert digest yourself."] },
  {
    h: "Data about web stores, ads and creators",
    p: [
      "The platform contains information about web stores (domain, products, prices, technology), ads from official ad libraries and public creator profiles. This is mostly business information.",
      "We collect no data about the customers of web stores. For creators we only process public, business data (handle, followers, public videos), based on legitimate interest. Reddit usernames are not stored.",
      "Revenue, visits and sales of third parties are estimates and are labelled as such.",
      "Objection or removal (for instance as a sole trader or creator): email privacy@trendscope.example with the URL or handle; we respond within 30 days.",
    ],
  },
  { h: "Processors", p: ["Hosting and databases (EU region), Stripe (payments), Resend (transactional email), Anthropic (AI features; only the question and the platform data needed, not used for training), and optionally Clerk (sign-in). A data processing agreement is in place with each processor. [Verify list and regions before launch.]"] },
  { h: "Retention", p: ["Account data while your account exists and up to 30 days after. Invoices 7 years (tax obligation). Audit logs 1 year. AI conversations until you delete them or close your workspace."] },
  { h: "Your rights", p: ["You have the right to access, rectification, erasure, restriction, portability and objection. You can also lodge a complaint with your data protection authority."] },
  { h: "Cookies", p: ["We only use functional cookies: your session, language and theme, and the selected workspace. No advertising or tracking cookies."] },
  { h: "Chrome extension", p: ["The extension never reads page content. Only the hostname of the active tab is sent to your own Trendscope environment, and only if you enabled the badge. Your API key stays local in your browser."] },
];

export default function PrivacyPage() {
  return <LegalPage title="privacyTitle" updated="22-11-2026" sections={{ nl, en }} />;
}
