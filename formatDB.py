import pandas as pd
import os

# CONFIGURAÇÃO
ARQUIVO_ENTRADA = 'dbcompl.csv'  # O arquivo com os dados que você mandou
ARQUIVO_SAIDA = 'dbform.csv'              # O arquivo final para o Node.js

def main():
    if not os.path.exists(ARQUIVO_ENTRADA):
        print(f"❌ Erro: Salve seus dados no arquivo '{ARQUIVO_ENTRADA}' primeiro.")
        return

    print(f"1. Lendo {ARQUIVO_ENTRADA}...")
    
    # Lê o CSV. O formato WiGLE usa vírgula como separador padrão.
    try:
        df = pd.read_csv(ARQUIVO_ENTRADA, encoding='utf-8')
    except:
        df = pd.read_csv(ARQUIVO_ENTRADA, encoding='latin1')

    print("2. Selecionando e renomeando colunas...")

    # Mapeamento das colunas do WiGLE para o nosso formato
    # Formato WiGLE -> Nosso Formato
    colunas_desejadas = {
        'SSID': 'SSID',
        'MAC': 'Adr MAC (BSSID)',
        'CurrentLatitude': 'Latitude',
        'CurrentLongitude': 'Longitude'
    }

    # Verifica se as colunas existem antes de processar
    colunas_existentes = [c for c in colunas_desejadas.keys() if c in df.columns]
    
    if len(colunas_existentes) < 4:
        print(f"⚠️ Aviso: Algumas colunas não foram encontradas. Colunas no arquivo: {list(df.columns)}")
        # Tenta continuar mesmo assim
    
    # Filtra apenas as colunas que queremos e renomeia
    df_final = df[colunas_existentes].rename(columns=colunas_desejadas)

    print("3. Normalizando dados...")

    # 1. Converter MAC para MAIÚSCULO (ex: aa:bb -> AA:BB)
    if 'Adr MAC (BSSID)' in df_final.columns:
        df_final['Adr MAC (BSSID)'] = df_final['Adr MAC (BSSID)'].astype(str).str.upper().str.strip()

    # 2. Preencher SSIDs vazios com "Hidden" ou "Desconhecido" (Opcional, mas ajuda visualmente)
    if 'SSID' in df_final.columns:
        df_final['SSID'] = df_final['SSID'].fillna('Hidden')

    # 3. Garantir que Latitude e Longitude são números válidos
    # O Pandas geralmente já faz isso, mas removemos linhas sem coordenada por segurança
    df_final = df_final.dropna(subset=['Latitude', 'Longitude'])

    
    # Salva no formato padrão: Vírgula, UTF-8, Sem índice
    df_final.to_csv(ARQUIVO_SAIDA, index=False, sep=',', encoding='utf-8')

    print("\n✅ Sucesso! O arquivo foi gerado formatado corretamente.")


if __name__ == "__main__":
    main()