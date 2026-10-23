import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Section,
  Text,
} from '@react-email/components';
import { emailTheme } from './theme';

export type MagicLinkProps = {
  /** Fully-qualified callback URL returned by Auth.js. */
  url: string;
  /** Host portion of the deployment (for masthead context). */
  host: string;
  /** Token expiry — embedded as a contextual line so the recipient knows the window. */
  expiresAt: Date;
};

const styles = {
  body: {
    backgroundColor: emailTheme.bgOuter,
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontSans,
    margin: 0,
    padding: '24px 0',
  },
  container: {
    backgroundColor: emailTheme.bgCard,
    border: `1px solid ${emailTheme.border}`,
    borderRadius: '4px',
    margin: '0 auto',
    maxWidth: '520px',
    overflow: 'hidden',
  },
  masthead: {
    backgroundColor: emailTheme.brandAccent,
    padding: '14px 24px',
  },
  mastheadText: {
    color: '#f5e6d3',
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    letterSpacing: '0.12em',
    margin: 0,
    textTransform: 'uppercase' as const,
  },
  content: { padding: '28px 24px' },
  heading: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontMono,
    fontSize: '18px',
    fontWeight: 600,
    letterSpacing: '0.04em',
    margin: '0 0 14px 0',
    textTransform: 'uppercase' as const,
  },
  para: {
    color: emailTheme.textSecondary,
    fontSize: '14px',
    lineHeight: 1.55,
    margin: '0 0 18px 0',
  },
  buttonRow: { margin: '24px 0 18px 0' },
  button: {
    backgroundColor: emailTheme.matrixGreen,
    borderRadius: '2px',
    color: '#001a08',
    display: 'inline-block',
    fontFamily: emailTheme.fontMono,
    fontSize: '13px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    padding: '12px 22px',
    textDecoration: 'none',
    textTransform: 'uppercase' as const,
  },
  fallback: {
    color: emailTheme.textMuted,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    lineHeight: 1.5,
    margin: '14px 0 0 0',
    wordBreak: 'break-all' as const,
  },
  hr: { borderColor: emailTheme.border, margin: '20px 0' },
  footer: {
    color: emailTheme.textMuted,
    fontFamily: emailTheme.fontMono,
    fontSize: '10px',
    letterSpacing: '0.05em',
    margin: 0,
  },
};

export function MagicLinkEmail({ url, host, expiresAt }: MagicLinkProps) {
  const expiresIn = formatExpiryWindow(expiresAt);

  return (
    <Html lang="en">
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.masthead}>
            <Text style={styles.mastheadText}>{`// Cocoa AI · Threat Deck`}</Text>
          </Section>

          <Section style={styles.content}>
            <Heading as="h1" style={styles.heading}>
              Sign-in link
            </Heading>
            <Text style={styles.para}>
              Use the button below to open Cocoa AI Threat Deck. This link is single-use and expires
              in {expiresIn}.
            </Text>

            <Section style={styles.buttonRow}>
              <Button href={url} style={styles.button}>
                Open Threat Deck →
              </Button>
            </Section>

            <Text style={styles.fallback}>
              Button not working? Paste this URL into your browser:
              {'\n'}
              {url}
            </Text>

            <Hr style={styles.hr} />

            <Text style={styles.footer}>
              {host} · If you didn’t request this, you can safely ignore the message.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** Render `24 hours`, `45 minutes`, etc — single-decimal precision. */
function formatExpiryWindow(expires: Date): string {
  const ms = expires.getTime() - Date.now();
  if (ms <= 0) return 'a moment';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}
