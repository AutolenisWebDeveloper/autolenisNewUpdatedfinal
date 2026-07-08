"use client";

import AdminSegmentError from "@/components/admin/AdminSegmentError";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AdminSegmentError segment="Queues" {...props} />;
}
