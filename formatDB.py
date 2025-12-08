import pandas as pd
import os

# CONFIGURATION
INPUT_FILE = 'dbcompl.csv'   # The file with the data you provided
OUTPUT_FILE = 'dbform.csv'   # The final file for Node.js

def main():
    if not os.path.exists(INPUT_FILE):
        print(f"❌ Error: Save your data in '{INPUT_FILE}' first.")
        return

    print(f"1. Reading {INPUT_FILE}...")
    
    # Reads the CSV. WiGLE format usually uses comma as default separator.
    try:
        df = pd.read_csv(INPUT_FILE, encoding='utf-8')
    except:
        df = pd.read_csv(INPUT_FILE, encoding='latin1')

    print("2. Selecting and renaming columns...")

    # Mapping WiGLE columns to our format
    # WiGLE Format -> Our Format
    desired_columns = {
        'SSID': 'SSID',
        'MAC': 'Adr MAC (BSSID)',       
        'CurrentLatitude': 'Latitude',
        'CurrentLongitude': 'Longitude'
    }

    # Checks if columns exist before processing
    existing_columns = [c for c in desired_columns.keys() if c in df.columns]
    
    if len(existing_columns) < 4:
        print(f"⚠️ Warning: Some columns were not found. Columns in file: {list(df.columns)}")
        # Tries to continue regardless
    
    # Filter only the columns we want and rename them
    df_final = df[existing_columns].rename(columns=desired_columns)

    print("3. Normalizing data...")

    # 1. Convert MAC to UPPERCASE (e.g., aa:bb -> AA:BB)
    if 'Adr MAC (BSSID)' in df_final.columns:
        df_final['Adr MAC (BSSID)'] = df_final['Adr MAC (BSSID)'].astype(str).str.upper().str.strip()

    # 2. Fill empty SSIDs with "Hidden" or "Unknown" (Optional, helps visually)
    if 'SSID' in df_final.columns:
        df_final['SSID'] = df_final['SSID'].fillna('Hidden')

    # 3. Ensure Latitude and Longitude are valid numbers
    # Pandas usually does this, but we remove lines without coordinates for safety
    df_final = df_final.dropna(subset=['Latitude', 'Longitude'])

    
    # Saves in standard format: Comma, UTF-8, No index
    df_final.to_csv(OUTPUT_FILE, index=False, sep=',', encoding='utf-8')

    print("\n✅ Success! The file was generated and formatted correctly.")


if __name__ == "__main__":
    main()