import { z } from 'zod';

import { ConnectorError, ConnectorErrorCodes } from '@logto/connector-kit';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

/** Static name-membership table for critical fields (names, not indices). */
const criticalFieldLookup: Record<string, boolean> = {
  ToUserName: true,
  FromUserName: true,
  CreateTime: true,
  MsgType: true,
  Event: true,
  EventKey: true,
  Encrypt: true,
  Ticket: true,
};

const isCriticalField = (key: string): boolean => criticalFieldLookup[key] === true;

const entityError = (): ConnectorError =>
  new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
    message: 'XML entities and DTD constructs are not allowed in WeChat callback payloads.',
  });

const invalidXmlError = (): ConnectorError =>
  new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
    message: 'Invalid WeChat callback XML payload.',
  });

const duplicateFieldError = (key: string): ConnectorError =>
  new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
    message: `Duplicate XML field \`${key}\` in WeChat callback payload.`,
  });

const fieldError = (key: string): ConnectorError =>
  new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
    message: `Invalid XML field \`${key}\` in WeChat callback payload.`,
  });

/**
 * CDATA sections are literal text and are never entity-expanded by XML processors, so
 * DTD/entity checks run on the payload with CDATA sections stripped. This keeps
 * legitimate literal content (e.g. a user message containing `&copy;`) working while
 * still rejecting real DTD/entity constructs, which only have meaning outside CDATA.
 */
const cdataSectionPattern = /<!\[CDATA\[[\S\s]*?]]>/g;

const assertNoXmlEntities = (xml: string): void => {
  const outsideCdata = xml.replaceAll(cdataSectionPattern, '');

  if (/<!doctype|<!entity/i.test(outsideCdata)) {
    throw entityError();
  }

  // Entity references other than the predefined XML ones (including numeric ones) never
  // legitimately appear outside CDATA in WeChat callback payloads.
  if (/&(?!amp;|lt;|gt;|quot;|apos;)[\d#A-Za-z]+;/.test(outsideCdata)) {
    throw entityError();
  }
};

/** A single CDATA section value, e.g. `<MsgType><![CDATA[event]]></MsgType>`. */
const cdataValueGuard = z.object({ __cdata: z.string() }).strict();

// `strict()` preserves the single-`xml`-root requirement: any other top-level element
// fails validation.
const wechatCallbackRootGuard = z.object({ xml: z.record(z.unknown()) }).strict();

/**
 * Strictly parses a WeChat callback XML payload.
 *
 * - Rejects malformed XML, DTD/entity constructs (outside CDATA), duplicate fields and
 *   non-scalar values for interpreted (critical) fields.
 * - Tolerates unknown fields, including nested elements (e.g. `ScanCodeInfo` in menu
 *   events), without interpreting them; only scalar/CDATA fields are returned.
 *
 * @throws {ConnectorError} with {@link ConnectorErrorCodes.InvalidRequestParameters} on
 * any structural violation.
 */
export const parseWechatCallbackXml = (xml: string): Record<string, string> => {
  assertNoXmlEntities(xml);

  const validation = XMLValidator.validate(xml, {
    allowBooleanAttributes: false,
  });

  if (validation !== true) {
    throw invalidXmlError();
  }

  const parser = new XMLParser({
    ignoreAttributes: true,
    // WeChat may prefix payloads with an XML declaration (`<?xml ... ?>`); without
    // this the declaration would surface as a `?xml` root property and fail the
    // strict single-`xml`-root guard below.
    ignoreDeclaration: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    cdataPropName: '__cdata',
    // DTD processing is disabled; entities would not be expanded even if a crafted
    // payload slipped past the pre-check above.
    processEntities: false,
  });

  const parsed: unknown = parser.parse(xml);
  const rootResult = wechatCallbackRootGuard.safeParse(parsed);

  if (!rootResult.success) {
    throw invalidXmlError();
  }

  /* eslint-disable @silverhand/fp/no-mutation -- Bounded scalar accumulator while walking parsed XML; avoids per-field intermediate arrays. */
  const fields: Record<string, string> = {};

  for (const [key, value] of Object.entries(rootResult.data.xml)) {
    // WeChat never sends repeated elements; duplicates indicate a tampered payload.
    if (Array.isArray(value)) {
      throw duplicateFieldError(key);
    }

    if (typeof value === 'string') {
      fields[key] = value;
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      const cdata = cdataValueGuard.safeParse(value);

      if (cdata.success) {
        fields[key] = cdata.data.__cdata;
        continue;
      }

      // Unknown nested elements are tolerated without interpretation; interpreted
      // fields must stay scalar.
      if (isCriticalField(key)) {
        throw fieldError(key);
      }

      continue;
    }

    if (isCriticalField(key)) {
      throw fieldError(key);
    }
  }
  /* eslint-enable @silverhand/fp/no-mutation */

  return fields;
};
