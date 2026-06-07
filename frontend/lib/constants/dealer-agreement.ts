// lib/constants/dealer-agreement.ts
//
// CRITICAL: Any change to DEALER_AGREEMENT_TEXT must also
// increment CURRENT_DEALER_AGREEMENT_VERSION. The SHA-256
// hash of this text is stored per signature record.
// Version + hash together constitute tamper-evident proof
// of exactly what was agreed to. Never edit text without
// bumping the version string.

export const CURRENT_DEALER_AGREEMENT_VERSION = "2026-06-01";

export const DEALER_AGREEMENT_TEXT = `
AUTOLENIS DEALER NETWORK PARTICIPATION AGREEMENT
Version: 2026-06-01 | Effective Date: June 1, 2026

This Dealer Network Participation Agreement ("Agreement") is
entered into between AutoLenis, LLC, a Texas limited liability
company ("AutoLenis"), and the dealer entity identified in the
onboarding profile ("Dealer").

1. PLATFORM ACCESS AND PURPOSE
AutoLenis operates a proprietary automotive marketplace
platform that facilitates competitive bidding by participating
dealers for qualified buyer vehicle requests. This Agreement
governs Dealer's participation in the AutoLenis dealer network.

2. DEALER ELIGIBILITY AND REPRESENTATIONS
Dealer represents and warrants that: (a) Dealer holds a valid,
current motor vehicle dealer license in each state where Dealer
conducts business; (b) all information provided during
onboarding is accurate and complete; (c) Dealer has authority
to enter into this Agreement on behalf of the dealership
entity; and (d) Dealer will maintain all required licenses in
good standing throughout the term of this Agreement.

3. PLATFORM CONDUCT OBLIGATIONS
Dealer agrees to: (a) provide accurate, complete vehicle
listings and pricing in all submitted offers; (b) respond to
auction invitations and buyer inquiries within the timeframes
specified by AutoLenis; (c) honor any accepted offer for the
price and terms submitted; (d) comply with all applicable
federal, state, and local laws governing vehicle sales; (e)
not engage in price manipulation, shill bidding, or any form
of deceptive conduct on the platform.

4. OFFER AND BIDDING RULES
All dealer offers submitted through the AutoLenis platform are
binding commitments. Dealer agrees that: (a) submitted
out-the-door (OTD) prices are final and inclusive of all
dealer fees; (b) post-submission price modifications are
prohibited except as permitted by written platform policy;
(c) AutoLenis reserves the right to remove or flag offers
that do not comply with platform standards.

5. AUTOLENIS FEES
Dealer agrees to pay AutoLenis the platform fee applicable to
each completed transaction, as disclosed in the Fee Schedule
provided during onboarding and updated from time to time with
reasonable advance notice. Fee terms are separately
communicated and incorporated herein by reference.

6. CONTRACT AND DOCUMENT OBLIGATIONS
Dealer agrees to upload accurate, complete transaction
documents for all accepted deals, cooperate with the AutoLenis
Contract Shield™ review process, and remediate any identified
contract deficiencies within the timeframes required by the
platform.

7. PERFORMANCE STANDARDS
AutoLenis maintains dealer performance scorecards measuring
offer accuracy, responsiveness, deal completion rate, and
contract quality. AutoLenis may restrict or suspend dealer
access based on sustained performance below platform
thresholds, with notice provided where practicable.

8. DATA AND CONFIDENTIALITY
Dealer agrees to treat buyer information provided through the
platform as confidential and to use such information solely
for the purpose of fulfilling the relevant vehicle
transaction. Dealer will not use buyer contact information
for unrelated marketing or solicitation.

9. TERM AND TERMINATION
This Agreement commences upon execution and continues until
terminated. Either party may terminate with thirty (30) days
written notice. AutoLenis may suspend or terminate immediately
for material breach, license lapse, fraudulent conduct, or
violation of platform rules.

10. LIMITATION OF LIABILITY
TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, AUTOLENIS
SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM DEALER'S USE
OF THE PLATFORM.

11. GOVERNING LAW AND VENUE
This Agreement shall be governed by the laws of the State of
Texas, without regard to conflict of law principles. Any
disputes shall be resolved exclusively in the state or federal
courts of Collin County, Texas.

12. ENTIRE AGREEMENT
This Agreement, together with the AutoLenis Privacy Policy and
Fee Schedule, constitutes the entire agreement between the
parties regarding dealer network participation and supersedes
all prior oral or written agreements on this subject.

AutoLenis, LLC
5830 Granite Parkway, Suite 100-356
Plano, TX 75024
support@autolenis.com
`.trim();
