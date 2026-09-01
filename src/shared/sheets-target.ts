/**
 * The raid sheet target — shared by the serializer (tab ID the sheets thread
 * writes to), the auth client (B1) and the writer (B2+). Single source of
 * truth so the tab title never drifts between modules.
 *
 * The test raid sheet is the operational destination for V1; production is
 * out of scope. Live geometry for the tab (sheetId 1945140668, 1068×15) is
 * resolved at runtime by GoogleSheetsService.getTab().
 */
export const DEFAULT_TAB = 'SOO-Assigns-Import' as const;