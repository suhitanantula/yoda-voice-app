export const metadata = {
  title: 'Yoda Voice',
  description: 'Talk to Yoda',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
