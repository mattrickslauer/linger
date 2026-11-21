// Sample documents. All original, fictional text written for Linger, in the dense register that
// real letters, leases and leaflets use. Names, agencies and products are invented.

import { DEMO_DOC, type Doc } from "./article";

const benefits: Doc = {
  title: "Notice of redetermination of eligibility",
  byline: "A letter from a fictional benefits office.",
  blocks: [
    {
      kind: "p",
      id: "b1",
      text: "This notice is to inform you that, following a periodic review of your household's circumstances, the Department has redetermined your eligibility for the Household Support Allowance effective from the first day of the next benefit period. The redetermination was conducted pursuant to the income verification provisions and reflects information obtained through data matching with employer wage records.",
    },
    {
      kind: "p",
      id: "b2",
      text: "Based on countable gross earned income in excess of the applicable threshold for a household of your size, your monthly allotment has been reduced. Earned income is assessed after the standard earned income disregard and any allowable dependent care deductions substantiated with acceptable verification. Unverified deductions have not been applied.",
    },
    {
      kind: "p",
      id: "b3",
      text: "An overpayment may have arisen for months in which reported income was less than income subsequently verified. If an overpayment is established, you will receive a separate notice of claim specifying the amount and the recoupment method. Recoupment will ordinarily be effected by reduction of future allotments unless you elect an alternative repayment arrangement.",
    },
    {
      kind: "p",
      id: "b4",
      text: "If you disagree with this determination you have the right to request a fair hearing. A request received within ten days of the date of this notice will entitle you to continued benefits at the previous level pending the hearing decision; however, any benefits received to which you are subsequently found not entitled will be subject to recovery.",
    },
    {
      kind: "p",
      id: "b5",
      text: "You must report any change in household composition, residence or gross monthly income exceeding the reporting threshold within ten days of the date the change becomes known to you. Failure to report timely may result in a claim against the household and, where intentional, disqualification for a specified period.",
    },
  ],
};

const lease: Doc = {
  title: "Residential tenancy agreement: selected clauses",
  byline: "Clauses from a fictional apartment lease.",
  blocks: [
    {
      kind: "p",
      id: "l1",
      text: "The Tenant shall pay the Rent in advance on or before the first day of each calendar month without deduction or set-off. Any instalment of Rent not received by the fifth day of the month shall incur a late charge equal to five percent of the overdue amount, which shall constitute additional rent hereunder and not a penalty.",
    },
    {
      kind: "p",
      id: "l2",
      text: "The Security Deposit shall be held by the Landlord as security for the faithful performance of the Tenant's obligations. Upon termination, the Landlord may apply the Deposit to unpaid Rent and to the cost of remedying damage beyond reasonable wear and tear, and shall return the balance together with an itemised statement within the period prescribed by applicable law.",
    },
    {
      kind: "p",
      id: "l3",
      text: "The Tenant shall indemnify and hold harmless the Landlord from and against any and all claims, liabilities and expenses arising from the Tenant's use of the Premises or the acts or omissions of the Tenant's invitees, save to the extent caused by the negligence or wilful misconduct of the Landlord.",
    },
    {
      kind: "p",
      id: "l4",
      text: "This Agreement shall automatically renew for successive periods of twelve months unless either party serves written notice of non-renewal not less than sixty days prior to the expiry of the then-current term. Upon renewal the Landlord may adjust the Rent by an amount not exceeding the increase permitted under applicable rent stabilisation provisions.",
    },
    {
      kind: "p",
      id: "l5",
      text: "The Tenant shall not assign this Agreement or sublet the whole or any part of the Premises without the prior written consent of the Landlord, such consent not to be unreasonably withheld. Any purported assignment or subletting in breach of this clause shall be void and shall constitute a material default entitling the Landlord to terminate.",
    },
  ],
};

const leaflet: Doc = {
  title: "Package leaflet: information for the patient",
  byline: "From a fictional medicine. Not medical advice; always follow your pharmacist or doctor.",
  blocks: [
    {
      kind: "p",
      id: "m1",
      text: "Velantrin 20 mg modified-release tablets contain the active substance velantrine, which belongs to a group of medicines called selective calcium channel modulators. It is used in adults to reduce the frequency of symptomatic episodes and is not intended for the acute relief of an episode already in progress.",
    },
    {
      kind: "p",
      id: "m2",
      text: "Do not take Velantrin if you are hypersensitive to velantrine or to any of the excipients listed in section 6, if you have severe hepatic impairment, or if you are concomitantly taking strong inhibitors of the CYP3A4 enzyme, as these may substantially increase plasma concentrations and the risk of adverse reactions.",
    },
    {
      kind: "p",
      id: "m3",
      text: "Swallow the tablet whole with water, at approximately the same time each day, with or without food. Do not crush or chew the tablet, as this would disrupt the modified-release mechanism and could result in a larger than intended dose being absorbed at once. If you miss a dose, take it as soon as you remember unless it is nearly time for the next dose; do not take a double dose.",
    },
    {
      kind: "p",
      id: "m4",
      text: "Like all medicines, this medicine can cause side effects, although not everybody gets them. Common side effects (may affect up to 1 in 10 people) include peripheral oedema, dizziness and flushing. Stop taking Velantrin and seek medical attention immediately if you experience signs of angioedema such as swelling of the face, lips or tongue, or difficulty breathing.",
    },
  ],
};

export interface LibraryEntry {
  doc: Doc;
  label: string;
  hint: string;
}

export const LIBRARY: LibraryEntry[] = [
  { doc: benefits, label: "A benefits letter", hint: "The kind of letter that decides whether rent gets paid" },
  { doc: lease, label: "A lease", hint: "Clauses people sign without understanding" },
  { doc: leaflet, label: "A medicine leaflet", hint: "Dense instructions, with no room for a mistake" },
  { doc: DEMO_DOC, label: "An explainer with a chart", hint: "Shows charts being explained in the cloud" },
];
