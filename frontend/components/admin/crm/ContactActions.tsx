'use client';

import { useState } from 'react';
import { Mail, MessageSquare } from 'lucide-react';
import { ComposeEmailModal } from './ComposeEmailModal';
import { ComposeSmsModal } from './ComposeSmsModal';

type Props = {
  contactId: string;
  email: string | null;
  phone: string | null;
  consentEmail: boolean;
  consentSms: boolean;
  doNotContact: boolean;
  name?: string;
};

export function ContactActions({
  contactId,
  email,
  phone,
  consentEmail,
  consentSms,
  doNotContact,
  name,
}: Props) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);

  const emailDisabled = !email || !consentEmail || doNotContact;
  const smsDisabled = !phone || !consentSms || doNotContact;

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          onClick={() => setEmailOpen(true)}
          disabled={emailDisabled}
          title={
            !email
              ? 'No email on file'
              : !consentEmail
                ? 'Contact has not opted in to email'
                : doNotContact
                  ? 'Contact is marked do-not-contact'
                  : 'Send email'
          }
          className="flex items-center justify-center gap-1.5 text-xs font-medium bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400 text-gray-700 rounded-lg px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Mail className="w-3.5 h-3.5" /> Email
        </button>
        <button
          onClick={() => setSmsOpen(true)}
          disabled={smsDisabled}
          title={
            !phone
              ? 'No phone on file'
              : !consentSms
                ? 'Contact has not opted in to SMS'
                : doNotContact
                  ? 'Contact is marked do-not-contact'
                  : 'Send SMS'
          }
          className="flex items-center justify-center gap-1.5 text-xs font-medium bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400 text-gray-700 rounded-lg px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" /> SMS
        </button>
      </div>

      {emailOpen && email && (
        <ComposeEmailModal
          contactId={contactId}
          contactEmail={email}
          contactName={name}
          onClose={() => setEmailOpen(false)}
        />
      )}
      {smsOpen && phone && (
        <ComposeSmsModal
          contactId={contactId}
          contactPhone={phone}
          consentSms={consentSms}
          contactName={name}
          onClose={() => setSmsOpen(false)}
        />
      )}
    </>
  );
}
