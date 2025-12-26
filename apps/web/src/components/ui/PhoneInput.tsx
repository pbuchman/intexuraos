import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Country configuration for phone input.
 */
interface CountryConfig {
  code: string;
  name: string;
  dialCode: string;
  flag: string;
  pattern: RegExp;
  placeholder: string;
  minLength: number;
  maxLength: number;
}

/**
 * Supported countries with their phone number configurations.
 * Pattern validates the local part (without country code).
 */
const COUNTRIES: CountryConfig[] = [
  {
    code: 'PL',
    name: 'Poland',
    dialCode: '+48',
    flag: '🇵🇱',
    pattern: /^[1-9]\d{8}$/,
    placeholder: '123 456 789',
    minLength: 9,
    maxLength: 9,
  },
  {
    code: 'US',
    name: 'United States',
    dialCode: '+1',
    flag: '🇺🇸',
    pattern: /^[2-9]\d{9}$/,
    placeholder: '(555) 123-4567',
    minLength: 10,
    maxLength: 10,
  },
];

interface PhoneInputProps {
  value: string;
  onChange: (fullNumber: string, isValid: boolean) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Parse a full phone number into country and local parts.
 */
function parsePhoneNumber(fullNumber: string): { countryCode: string; localNumber: string } {
  const cleaned = fullNumber.replace(/\D/g, '');

  // Try to match against known country codes
  for (const country of COUNTRIES) {
    const dialDigits = country.dialCode.replace('+', '');
    if (cleaned.startsWith(dialDigits)) {
      return {
        countryCode: country.code,
        localNumber: cleaned.slice(dialDigits.length),
      };
    }
  }

  // Default to Poland if no match
  return { countryCode: 'PL', localNumber: cleaned };
}

/**
 * Validate phone number for a specific country.
 */
function validatePhoneNumber(localNumber: string, country: CountryConfig): boolean {
  const digitsOnly = localNumber.replace(/\D/g, '');
  return country.pattern.test(digitsOnly);
}

/**
 * Format phone number for display (adds spaces/dashes based on country).
 */
function formatLocalNumber(localNumber: string, countryCode: string): string {
  const digits = localNumber.replace(/\D/g, '');

  if (countryCode === 'PL') {
    // Format: XXX XXX XXX
    return digits.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3').trim();
  }

  if (countryCode === 'US') {
    // Format: (XXX) XXX-XXXX
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }

  return digits;
}

export function PhoneInput({
  value,
  onChange,
  className = '',
  disabled = false,
}: PhoneInputProps): React.JSX.Element {
  const { countryCode, localNumber } = parsePhoneNumber(value);
  const [selectedCountry, setSelectedCountry] = useState<CountryConfig>(
    COUNTRIES.find((c) => c.code === countryCode) ?? (COUNTRIES[0] as CountryConfig)
  );
  const [localValue, setLocalValue] = useState(localNumber);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleLocalChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const inputValue = e.target.value;
    // Only allow digits and formatting characters
    const digitsOnly = inputValue.replace(/\D/g, '');

    // Limit to max length
    const trimmed = digitsOnly.slice(0, selectedCountry.maxLength);

    setLocalValue(trimmed);

    // Build full number and validate
    const fullNumber = `${selectedCountry.dialCode}${trimmed}`;
    const isValid = validatePhoneNumber(trimmed, selectedCountry);
    onChange(fullNumber, isValid);
  };

  const handleCountrySelect = (country: CountryConfig): void => {
    setSelectedCountry(country);
    setIsOpen(false);

    // Rebuild full number with new country code
    const fullNumber = `${country.dialCode}${localValue}`;
    const isValid = validatePhoneNumber(localValue, country);
    onChange(fullNumber, isValid);
  };

  const isValid = validatePhoneNumber(localValue, selectedCountry);
  const displayValue = formatLocalNumber(localValue, selectedCountry.code);

  return (
    <div className={`flex ${className}`}>
      {/* Country dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setIsOpen(!isOpen);
          }}
          className="flex h-full items-center gap-1 rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm transition-colors hover:bg-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="text-lg">{selectedCountry.flag}</span>
          <span className="font-medium text-slate-700">{selectedCountry.dialCode}</span>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>

        {isOpen ? (
          <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {COUNTRIES.map((country) => (
              <button
                key={country.code}
                type="button"
                onClick={() => {
                  handleCountrySelect(country);
                }}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100 ${
                  country.code === selectedCountry.code
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-700'
                }`}
              >
                <span className="text-lg">{country.flag}</span>
                <span className="flex-1">{country.name}</span>
                <span className="text-slate-500">{country.dialCode}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Phone number input */}
      <input
        type="tel"
        value={displayValue}
        onChange={handleLocalChange}
        disabled={disabled}
        placeholder={selectedCountry.placeholder}
        className={`block flex-1 rounded-r-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-50 ${
          localValue.length > 0 && !isValid
            ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
            : ''
        }`}
      />
    </div>
  );
}
