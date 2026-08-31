import { getAPIBaseUrl } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { TranslationProvider } from '../types';
import { normalizeToShortLang } from '@/utils/lang';

const DEEPL_API_ENDPOINT = getAPIBaseUrl() + '/deepl/translate';

/**
 * DeepL language codes are upper-case, but the service answers 500 when the
 * *script* subtag is upper-cased too. Measured against the live endpoint:
 * `ZH-HANT` and `ZH-TW` both fail, while `ZH-Hant` answers 200 with real
 * Traditional Chinese — and the same holds for `source_lang`. Upper-casing the
 * whole code therefore turned every zh-TW/zh-HK/zh-MO translation into a hard
 * failure. `normalizeToShortLang` already returns the canonical `zh-Hans` /
 * `zh-Hant`, so only the primary subtag is upper-cased and the script subtag
 * keeps the casing it came with. Languages without a script subtag ('en' -> 'EN',
 * and 'AUTO' -> 'AUTO') are unaffected.
 */
const toDeepLLang = (lang: string): string => {
  const [primary, ...rest] = normalizeToShortLang(lang).split('-');
  return [primary!.toUpperCase(), ...rest].join('-');
};

export const deeplProvider: TranslationProvider = {
  name: 'deepl',
  label: _('DeepL'),
  // Official Readest account login is removed in this fork: DeepL is
  // configured with API keys and never requires a Readest login.
  authRequired: false,
  // No `preservesMarkup`: round-tripping inline markup through this endpoint
  // corrupts it, silently and inconsistently. Measured against the live API —
  // `<b>` and `<i>` alone survive, but `<em>` is dropped outright, and when a
  // sentence carries both bold and italic the bold content is moved outside
  // its own tag, leaving an empty `<b></b>` so nothing renders bold. Losing
  // the formatting while keeping the text (the plain-text path) is better than
  // emitting markup that lies about it.
  // DeepL proper supports `tag_handling=html`, but that would have to be set
  // by the /deepl/translate service, which lives outside this repo; passing the
  // field from here is ignored.
  quotaExceeded: false,
  translate: async (
    text: string[],
    sourceLang: string,
    targetLang: string,
    _token?: string | null,
    useCache: boolean = false,
  ): Promise<string[]> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const normalizedSourceLang = toDeepLLang(sourceLang);
    const body = JSON.stringify({
      text: text,
      ...(normalizedSourceLang !== 'AUTO' ? { source_lang: normalizedSourceLang } : {}),
      target_lang: toDeepLLang(targetLang),
      use_cache: useCache,
    });

    try {
      const response = await fetch(DEEPL_API_ENDPOINT, { method: 'POST', headers, body });

      if (!response.ok) {
        throw new Error(`Translation failed with status ${response.status}`);
      }

      const data = await response.json();
      if (!data || !data.translations) {
        throw new Error('Invalid response from translation service');
      }

      return text.map((line, i) => {
        if (!line?.trim().length) {
          return line;
        }
        const translation = data.translations?.[i];
        return translation?.text || line;
      });
    } catch (error) {
      throw error;
    }
  },
};
