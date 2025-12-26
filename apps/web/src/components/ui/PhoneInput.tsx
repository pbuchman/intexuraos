import { useState, useEffect, useRef, useMemo, type ChangeEvent } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberWithError,
  AsYouType,
  type CountryCode,
} from 'libphonenumber-js';

/**
 * Country configuration for phone input.
 */
interface CountryConfig {
  code: CountryCode;
  name: string;
  dialCode: string;
  flag: string;
}

/**
 * Country code to flag emoji mapping.
 * Uses regional indicator symbols to generate flag emojis.
 */
function getCountryFlag(countryCode: CountryCode): string {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

/**
 * Get country name from country code using Intl API.
 */
function getCountryName(countryCode: CountryCode): string {
  try {
    const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

/**
 * Build list of all supported countries with PL and US prioritized.
 */
function buildCountryList(): CountryConfig[] {
  const countries = getCountries();
  const priorityCodes: CountryCode[] = ['PL', 'US'];

  const toConfig = (code: CountryCode): CountryConfig => ({
    code,
    name: getCountryName(code),
    dialCode: `+${getCountryCallingCode(code)}`,
    flag: getCountryFlag(code),
  });

  const priority = priorityCodes.map(toConfig);

  const rest = countries
    .filter((c) => !priorityCodes.includes(c))
    .sort((a, b) => getCountryName(a).localeCompare(getCountryName(b)))
    .map(toConfig);

  return [...priority, ...rest];
}

const COUNTRIES = buildCountryList();
const DEFAULT_COUNTRY = COUNTRIES[0] as CountryConfig;

interface PhoneInputProps {
  value: string;
  onChange: (fullNumber: string, isValid: boolean) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Parse a full phone number into country and local parts using libphonenumber-js.
 */
function parsePhoneNumber(fullNumber: string): { countryCode: CountryCode; localNumber: string } {
  const cleaned = fullNumber.replace(/\D/g, '');

  if (cleaned.length === 0) {
    return { countryCode: DEFAULT_COUNTRY.code, localNumber: '' };
  }

  try {
    const parsed = parsePhoneNumberWithError(`+${cleaned}`);
    if (parsed.country !== undefined) {
      const dialCode = getCountryCallingCode(parsed.country);
      const localNumber = cleaned.startsWith(dialCode) ? cleaned.slice(dialCode.length) : cleaned;
      return { countryCode: parsed.country, localNumber };
    }
  } catch {
    // Fall through to default
  }

  // Default to Poland if no match
  return { countryCode: DEFAULT_COUNTRY.code, localNumber: cleaned };
}

/**
 * Validate phone number using libphonenumber-js.
 */
function validatePhoneNumber(fullNumber: string): boolean {
  try {
    const parsed = parsePhoneNumberWithError(fullNumber);
    return parsed.isValid();
  } catch {
    return false;
  }
}

/**
 * Format phone number for display using AsYouType formatter.
 */
function formatLocalNumber(localNumber: string, countryCode: CountryCode): string {
  if (localNumber.length === 0) return '';

  const formatter = new AsYouType(countryCode);
  const dialCode = getCountryCallingCode(countryCode);
  const fullNumber = `+${dialCode}${localNumber}`;
  const formatted = formatter.input(fullNumber);

  // Remove the country code prefix from formatted output
  const dialCodeWithPlus = `+${dialCode}`;
  if (formatted.startsWith(dialCodeWithPlus)) {
    return formatted.slice(dialCodeWithPlus.length).trim();
  }

  return localNumber;
}

export function PhoneInput({
  value,
  onChange,
  className = '',
  disabled = false,
}: PhoneInputProps): React.JSX.Element {
  const { countryCode, localNumber } = parsePhoneNumber(value);
  const [selectedCountry, setSelectedCountry] = useState<CountryConfig>(
    COUNTRIES.find((c) => c.code === countryCode) ?? DEFAULT_COUNTRY
  );
  const [localValue, setLocalValue] = useState(localNumber);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter countries based on search query
  const filteredCountries = useMemo(() => {
    if (searchQuery.trim() === '') return COUNTRIES;
    const query = searchQuery.toLowerCase();
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.code.toLowerCase().includes(query) ||
        c.dialCode.includes(query)
    );
  }, [searchQuery]);

  // Update local value when external value changes
  useEffect(() => {
    const { countryCode: parsedCountry, localNumber: parsedLocal } = parsePhoneNumber(value);
    const country = COUNTRIES.find((c) => c.code === parsedCountry);
    if (country !== undefined) {
      setSelectedCountry(country);
    }
    setLocalValue(parsedLocal);
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (dropdownRef.current !== null && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current !== null) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handleLocalChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const inputValue = e.target.value;
    // Only allow digits
    const digitsOnly = inputValue.replace(/\D/g, '');

    // Limit to reasonable max length (15 digits is E.164 max without country code)
    const trimmed = digitsOnly.slice(0, 15);

    setLocalValue(trimmed);

    // Build full number and validate
    const fullNumber = `${selectedCountry.dialCode}${trimmed}`;
    const isValid = validatePhoneNumber(fullNumber);
    onChange(fullNumber, isValid);
  };

  const handleCountrySelect = (country: CountryConfig): void => {
    setSelectedCountry(country);
    setIsOpen(false);
    setSearchQuery('');

    // Rebuild full number with new country code
    const fullNumber = `${country.dialCode}${localValue}`;
    const isValid = validatePhoneNumber(fullNumber);
    onChange(fullNumber, isValid);
  };

  const fullNumber = `${selectedCountry.dialCode}${localValue}`;
  const isValid = localValue.length > 0 && validatePhoneNumber(fullNumber);
  const displayValue = formatLocalNumber(localValue, selectedCountry.code);

  return (
    <div className={`flex ${className}`}>
      {/* Country dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={(): void => {
            setIsOpen(!isOpen);
          }}
          className="flex h-full items-center gap-1 rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm transition-colors hover:bg-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="text-lg">{selectedCountry.flag}</span>
          <span className="font-medium text-slate-700">{selectedCountry.dialCode}</span>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>

        {isOpen ? (
          <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-lg border border-slate-200 bg-white shadow-lg">
            {/* Search input */}
            <div className="border-b border-slate-200 p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e): void => {
                    setSearchQuery(e.target.value);
                  }}
                  placeholder="Search country..."
                  className="w-full rounded border border-slate-200 py-1.5 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
                />
              </div>
            </div>

            {/* Country list */}
            <div className="max-h-60 overflow-y-auto py-1">
              {filteredCountries.length === 0 ? (
                <div className="px-3 py-2 text-sm text-slate-500">No countries found</div>
              ) : (
                filteredCountries.map((country) => (
                  <button
                    key={country.code}
                    type="button"
                    onClick={(): void => {
                      handleCountrySelect(country);
                    }}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100 ${
                      country.code === selectedCountry.code
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-700'
                    }`}
                  >
                    <span className="text-lg">{country.flag}</span>
                    <span className="flex-1 truncate">{country.name}</span>
                    <span className="text-slate-500">{country.dialCode}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Phone number input */}
      <input
        type="tel"
        value={displayValue}
        onChange={handleLocalChange}
        disabled={disabled}
        placeholder="Enter phone number"
        className={`block flex-1 rounded-r-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-50 ${
          localValue.length > 0 && !isValid
            ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
            : ''
        }`}
      />
    </div>
  );
}
