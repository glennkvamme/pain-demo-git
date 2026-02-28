using System.Globalization;
using System.Security;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

var options = new WebApplicationOptions
{
    Args = args,
    WebRootPath = "public"
};
var builder = WebApplication.CreateBuilder(options);

var app = builder.Build();
var dataStore = new DataStore(app.Environment.ContentRootPath);
dataStore.EnsureStores();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/creditors", () =>
{
    try
    {
        var creditors = dataStore.ReadCreditors();
        return Results.Json(creditors);
    }
    catch
    {
        return Results.Json(new { error = "Kunne ikke lese kreditorliste." }, statusCode: 500);
    }
});

app.MapGet("/api/foringer", () =>
{
    try
    {
        var items = dataStore.ReadForinger()
            .OrderByDescending(item => item.UpdatedAt ?? item.CreatedAt ?? string.Empty, StringComparer.Ordinal)
            .ToList();
        return Results.Json(items);
    }
    catch
    {
        return Results.Json(new { error = "Kunne ikke lese foringsliste." }, statusCode: 500);
    }
});

app.MapGet("/api/foringer/{id}", (string id) =>
{
    try
    {
        var item = dataStore.ReadForinger().FirstOrDefault(x => x.Id == id);
        if (item is null)
        {
            return Results.Json(new { error = "Fant ikke foringen." }, statusCode: 404);
        }

        return Results.Json(item);
    }
    catch
    {
        return Results.Json(new { error = "Kunne ikke lese foringen." }, statusCode: 500);
    }
});

app.MapPost("/api/foringer", async (HttpRequest request) =>
{
    CreateForingRequest? payload;
    try
    {
        payload = await request.ReadFromJsonAsync<CreateForingRequest>();
    }
    catch
    {
        payload = null;
    }

    var cloNumber = (payload?.CloNumber ?? string.Empty).Trim();
    var caseHandler = (payload?.CaseHandler ?? string.Empty).Trim();

    if (string.IsNullOrWhiteSpace(cloNumber) || string.IsNullOrWhiteSpace(caseHandler))
    {
        return Results.Json(new { error = "CLO nummer og saksbehandler ma fylles ut." }, statusCode: 400);
    }

    try
    {
        var list = dataStore.ReadForinger();
        var exists = list.Any(item => string.Equals(item.CloNumber, cloNumber, StringComparison.OrdinalIgnoreCase));
        if (exists)
        {
            return Results.Json(new { error = "Det finnes allerede en foring med dette CLO nummeret." }, statusCode: 409);
        }

        var now = DateTime.UtcNow.ToString("o");
        var created = new ForingDocument
        {
            Id = Guid.NewGuid().ToString(),
            CloNumber = cloNumber,
            CaseHandler = caseHandler,
            Etableringshonorar = string.Empty,
            CreatedAt = now,
            UpdatedAt = now,
            Status = ForingStatuses.Pagaende,
            Entries = new List<IncomingEntry>()
        };

        list.Add(created);
        dataStore.WriteForinger(list);
        return Results.Json(created, statusCode: 201);
    }
    catch
    {
        return Results.Json(new { error = "Kunne ikke opprette foring." }, statusCode: 500);
    }
});

app.MapPut("/api/foringer/{id}", async (string id, HttpRequest request) =>
{
    UpdateForingRequest? payload;
    try
    {
        payload = await request.ReadFromJsonAsync<UpdateForingRequest>();
    }
    catch
    {
        payload = null;
    }

    try
    {
        var list = dataStore.ReadForinger();
        var item = list.FirstOrDefault(x => x.Id == id);
        if (item is null)
        {
            return Results.Json(new { error = "Fant ikke foringen." }, statusCode: 404);
        }

        if (payload?.CloNumber is not null)
        {
            var cloNumber = payload.CloNumber.Trim();
            if (string.IsNullOrWhiteSpace(cloNumber))
            {
                return Results.Json(new { error = "CLO nummer ma fylles ut." }, statusCode: 400);
            }

            var duplicate = list.Any(x => x.Id != id && string.Equals(x.CloNumber, cloNumber, StringComparison.OrdinalIgnoreCase));
            if (duplicate)
            {
                return Results.Json(new { error = "Det finnes allerede en foring med dette CLO nummeret." }, statusCode: 409);
            }

            item.CloNumber = cloNumber;
        }

        if (payload?.CaseHandler is not null)
        {
            var caseHandler = payload.CaseHandler.Trim();
            if (string.IsNullOrWhiteSpace(caseHandler))
            {
                return Results.Json(new { error = "Saksbehandler ma fylles ut." }, statusCode: 400);
            }
            item.CaseHandler = caseHandler;
        }

        if (payload?.Etableringshonorar is not null)
        {
            item.Etableringshonorar = payload.Etableringshonorar.Trim();
        }

        if (payload?.Entries is not null)
        {
            item.Entries = payload.Entries;
        }

        if (payload?.Status is not null)
        {
            var normalizedStatus = ForingStatuses.Normalize(payload.Status);
            if (normalizedStatus is null)
            {
                return Results.Json(new { error = "Ugyldig status. Velg Pågående, Avsluttet eller Utbetalt." }, statusCode: 400);
            }

            item.Status = normalizedStatus;
        }

        item.UpdatedAt = DateTime.UtcNow.ToString("o");
        dataStore.WriteForinger(list);
        return Results.Json(item);
    }
    catch
    {
        return Results.Json(new { error = "Kunne ikke oppdatere foring." }, statusCode: 500);
    }
});

app.MapPut("/api/creditors", async (HttpRequest request) =>
{
    try
    {
        var payload = await request.ReadFromJsonAsync<UpdateCreditorsPayload>();
        var validated = Validation.ValidateCreditorsList(payload?.Creditors);
        if (validated.Error is not null)
        {
            return Results.Json(new { error = validated.Error }, statusCode: 400);
        }

        dataStore.WriteCreditors(validated.Value!);
        return Results.Json(new { ok = true, count = validated.Value!.Count });
    }
    catch
    {
        return Results.Json(new { error = "Kunne ikke lagre kreditorliste." }, statusCode: 500);
    }
});

app.MapGet("/api/history", () =>
{
    try
    {
        var history = dataStore.ReadHistory();
        return Results.Json(history);
    }
    catch
    {
        return Results.Json(new { error = "Kunne ikke lese historikk." }, statusCode: 500);
    }
});

app.MapGet("/api/history/{id}/download", (string id) =>
{
    try
    {
        var historyEntries = dataStore.ReadHistory();
        var entry = historyEntries.FirstOrDefault(item => item.Id == id);
        if (entry is null)
        {
            return Results.Json(new { error = "Fant ikke historikk-oppforing." }, statusCode: 404);
        }

        var fullPath = Path.Combine(dataStore.BackupDirectory, entry.BackupFileName);
        if (!File.Exists(fullPath))
        {
            return Results.Json(new { error = "Backup-filen finnes ikke." }, statusCode: 404);
        }

        return Results.File(fullPath, "application/octet-stream", entry.GeneratedFileName ?? entry.BackupFileName);
    }
    catch
    {
        return Results.Json(new { error = "Kunne ikke hente backup-fil." }, statusCode: 500);
    }
});

app.MapPost("/api/pain001", async (HttpRequest request) =>
{
    PainRequest? payload;
    try
    {
        payload = await request.ReadFromJsonAsync<PainRequest>();
    }
    catch
    {
        payload = null;
    }

    var entries = payload?.Entries ?? new List<IncomingEntry>();
    var caseHandler = (payload?.CaseHandler ?? string.Empty).Trim();
    var cloNumber = (payload?.CloNumber ?? string.Empty).Trim();
    var foringId = (payload?.ForingId ?? string.Empty).Trim();

    if (entries.Count == 0)
    {
        return Results.Json(new { error = "Send inn minst en linje i entries." }, statusCode: 400);
    }

    if (string.IsNullOrWhiteSpace(caseHandler) || string.IsNullOrWhiteSpace(cloNumber))
    {
        return Results.Json(new { error = "Saksbehandler og CLO nummer ma fylles ut." }, statusCode: 400);
    }

    var validated = new List<ValidatedEntry>();
    for (var i = 0; i < entries.Count; i += 1)
    {
        var result = Validation.ValidateEntry(entries[i], i + 1);
        if (result.Error is not null)
        {
            return Results.Json(new { error = result.Error }, statusCode: 400);
        }

        validated.Add(result.Value!);
    }

    var xml = PainXml.Build(validated);
    var nowUtc = DateTime.UtcNow;
    var stamp = nowUtc.ToString("o");
    var compactStamp = nowUtc.ToString("yyyyMMddHHmmss");
    var generatedFileName = PainXml.BuildGeneratedFileName(DateTime.Now);
    var backupFileName = $"pain001_{compactStamp}_{Guid.NewGuid().ToString("N")[..8]}.xml";

    File.WriteAllText(Path.Combine(dataStore.BackupDirectory, backupFileName), xml);

    var historyEntries = dataStore.ReadHistory();
    historyEntries.Add(new HistoryEntry
    {
        Id = Guid.NewGuid().ToString(),
        CreatedAt = stamp,
        CaseHandler = caseHandler,
        CloNumber = cloNumber,
        TransactionsCount = validated.Count,
        GeneratedFileName = generatedFileName,
        BackupFileName = backupFileName,
    });
    dataStore.WriteHistory(historyEntries);

    if (!string.IsNullOrWhiteSpace(foringId))
    {
        var foringer = dataStore.ReadForinger();
        var foring = foringer.FirstOrDefault(x => x.Id == foringId);
        if (foring is not null)
        {
            foring.UpdatedAt = DateTime.UtcNow.ToString("o");
            dataStore.WriteForinger(foringer);
        }
    }

    return Results.File(Encoding.UTF8.GetBytes(xml), "application/xml; charset=utf-8", generatedFileName);
});

app.MapFallback(async context =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.StatusCode = 404;
        return;
    }

    context.Response.ContentType = "text/html; charset=utf-8";
    await context.Response.SendFileAsync(Path.Combine(app.Environment.WebRootPath!, "index.html"));
});

var portValue = Environment.GetEnvironmentVariable("PORT");
if (!int.TryParse(portValue, out var port))
{
    port = 3200;
}

app.Urls.Clear();
app.Urls.Add($"http://localhost:{port}");
app.Run();

sealed class DataStore(string rootPath)
{
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public string DataDirectory { get; } = Path.Combine(rootPath, "data");
    public string CreditorsFile { get; } = Path.Combine(rootPath, "data", "creditors.json");
    public string HistoryFile { get; } = Path.Combine(rootPath, "data", "history.json");
    public string ForingerFile { get; } = Path.Combine(rootPath, "data", "foringer.json");
    public string BackupDirectory { get; } = Path.Combine(rootPath, "backups");

    public void EnsureStores()
    {
        Directory.CreateDirectory(DataDirectory);
        Directory.CreateDirectory(BackupDirectory);
        if (!File.Exists(CreditorsFile))
        {
            File.WriteAllText(CreditorsFile, "[]");
        }

        if (!File.Exists(HistoryFile))
        {
            File.WriteAllText(HistoryFile, "[]");
        }

        if (!File.Exists(ForingerFile))
        {
            File.WriteAllText(ForingerFile, "[]");
        }
    }

    public List<CreditorRecord> ReadCreditors()
    {
        EnsureStores();
        var parsed = DeserializeFile<List<CreditorRecord>>(CreditorsFile) ?? new List<CreditorRecord>();

        return parsed
            .Select(raw => Validation.SanitizeCreditor(raw))
            .Where(creditor => !string.IsNullOrWhiteSpace(creditor.Name))
            .OrderBy(creditor => creditor.Name, StringComparer.Create(new CultureInfo("nb-NO"), ignoreCase: false))
            .ToList();
    }

    public void WriteCreditors(List<CreditorRecord> creditors)
    {
        EnsureStores();
        var json = JsonSerializer.Serialize(creditors, _jsonOptions);
        File.WriteAllText(CreditorsFile, json);
    }

    public List<HistoryEntry> ReadHistory()
    {
        EnsureStores();
        var parsed = DeserializeFile<List<HistoryEntry>>(HistoryFile) ?? new List<HistoryEntry>();
        return parsed
            .OrderByDescending(item => item.CreatedAt ?? string.Empty, StringComparer.Ordinal)
            .ToList();
    }

    public void WriteHistory(List<HistoryEntry> entries)
    {
        EnsureStores();
        var json = JsonSerializer.Serialize(entries, _jsonOptions);
        File.WriteAllText(HistoryFile, json);
    }

    public List<ForingDocument> ReadForinger()
    {
        EnsureStores();
        var entries = DeserializeFile<List<ForingDocument>>(ForingerFile) ?? new List<ForingDocument>();
        foreach (var entry in entries)
        {
            entry.Status = ForingStatuses.Normalize(entry.Status) ?? ForingStatuses.Pagaende;
        }
        return entries;
    }

    public void WriteForinger(List<ForingDocument> entries)
    {
        EnsureStores();
        var json = JsonSerializer.Serialize(entries, _jsonOptions);
        File.WriteAllText(ForingerFile, json);
    }

    private T? DeserializeFile<T>(string filePath)
    {
        var content = File.ReadAllText(filePath);
        if (!string.IsNullOrEmpty(content) && content[0] == '\uFEFF')
        {
            content = content[1..];
        }

        return JsonSerializer.Deserialize<T>(content, _jsonOptions);
    }
}

static class Validation
{
    private static readonly Regex CustomerNotePattern = new(
        @"^Saksnr:\s*([^|]+)\s*\|\s*Eier:\s*(.+)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static ValidationResult<List<CreditorRecord>> ValidateCreditorsList(List<CreditorRecord>? rawList)
    {
        if (rawList is null)
        {
            return ValidationResult<List<CreditorRecord>>.Fail("creditors ma vaere en liste.");
        }

        var normalizedNameSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var result = new List<CreditorRecord>();

        for (var i = 0; i < rawList.Count; i += 1)
        {
            var creditor = SanitizeCreditor(rawList[i]);
            var line = i + 1;

            if (string.IsNullOrWhiteSpace(creditor.Name))
            {
                return ValidationResult<List<CreditorRecord>>.Fail($"Kreditor linje {line}: Navn ma fylles ut.");
            }

            if (!normalizedNameSet.Add(creditor.Name))
            {
                return ValidationResult<List<CreditorRecord>>.Fail($"Kreditor linje {line}: Duplikat navn ({creditor.Name}).");
            }

            if (!string.IsNullOrWhiteSpace(creditor.AccountNumber) &&
                (!Modulus.IsOnlyDigits(creditor.AccountNumber) || creditor.AccountNumber.Length != 11 || !Modulus.IsValidMod11(creditor.AccountNumber)))
            {
                return ValidationResult<List<CreditorRecord>>.Fail($"Kreditor linje {line}: Ugyldig kontonummer (modulus-sjekk feilet).");
            }

            result.Add(creditor);
        }

        var sorted = result
            .OrderBy(c => c.Name, StringComparer.Create(new CultureInfo("nb-NO"), ignoreCase: false))
            .ToList();
        return ValidationResult<List<CreditorRecord>>.Ok(sorted);
    }

    public static CreditorRecord SanitizeCreditor(CreditorRecord? raw)
    {
        var name = (raw?.Name ?? string.Empty).Trim();
        var accountNumber = string.Concat((raw?.AccountNumber ?? string.Empty).Where(c => !char.IsWhiteSpace(c)));
        return new CreditorRecord
        {
            Id = string.IsNullOrWhiteSpace(raw?.Id) ? Guid.NewGuid().ToString() : raw!.Id,
            Name = name,
            AccountNumber = accountNumber
        };
    }

    public static ValidationResult<ValidatedEntry> ValidateEntry(IncomingEntry entry, int lineNumber)
    {
        var cleanCreditor = (entry.Creditor ?? string.Empty).Trim();
        var cleanKid = string.Concat((entry.Kid ?? string.Empty).Where(c => !char.IsWhiteSpace(c)));
        var cleanCustomerNote = (entry.CustomerNote ?? string.Empty).Trim();
        var cleanInternalNote = (entry.InternalNote ?? string.Empty).Trim();
        var cleanAccountNumber = string.Concat((entry.AccountNumber ?? string.Empty).Where(c => !char.IsWhiteSpace(c)));
        var dueDate = (entry.DueDate ?? string.Empty).Trim();
        var hasKid = cleanKid.Length > 0;
        var hasCustomerNote = cleanCustomerNote.Length > 0;
        var formattedAmount = Amount.TryFormat(entry.Amount);

        if (string.IsNullOrWhiteSpace(cleanCreditor))
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Kreditor ma fylles ut.");
        }

        if (hasKid && hasCustomerNote)
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Notat til kunde kan kun brukes nar KID-feltet er tomt.");
        }

        if (!hasKid && !hasCustomerNote)
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Fyll inn enten KID eller notat til kunde.");
        }

        if (hasKid &&
            (!Modulus.IsOnlyDigits(cleanKid) || cleanKid.Length < 2 || cleanKid.Length > 25 ||
             (!Modulus.IsValidMod10(cleanKid) && !Modulus.IsValidMod11(cleanKid))))
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Ugyldig KID (modulus-sjekk feilet).");
        }

        if (hasCustomerNote && (cleanCustomerNote.Length < 2 || cleanCustomerNote.Length > 35))
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Notat til kunde ma vaere mellom 2 og 35 tegn.");
        }

        if (hasCustomerNote && !CustomerNotePattern.IsMatch(cleanCustomerNote))
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Notat til kunde ma ha format \"Saksnr: ... | Eier: ...\".");
        }

        if (!Modulus.IsOnlyDigits(cleanAccountNumber) || cleanAccountNumber.Length != 11 || !Modulus.IsValidMod11(cleanAccountNumber))
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Ugyldig kontonummer (modulus-sjekk feilet).");
        }

        if (formattedAmount is null)
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Belop ma vaere et positivt tall.");
        }

        if (!DueDate.IsTodayOrFuture(dueDate))
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Dato ma vaere i dag eller frem i tid.");
        }

        if (cleanInternalNote.Length > 140)
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Internt notat kan maks vaere 140 tegn.");
        }

        return ValidationResult<ValidatedEntry>.Ok(new ValidatedEntry
        {
            Creditor = cleanCreditor,
            Kid = cleanKid,
            CustomerNote = cleanCustomerNote,
            EndToEndId = hasKid ? cleanKid : cleanCustomerNote,
            InternalNote = cleanInternalNote,
            AccountNumber = cleanAccountNumber,
            Amount = formattedAmount,
            DueDate = dueDate
        });
    }
}

static class Modulus
{
    public static bool IsOnlyDigits(string value) => value.All(char.IsDigit);

    public static bool IsValidMod10(string numberString)
    {
        if (!IsOnlyDigits(numberString) || numberString.Length < 2) return false;

        var digits = numberString.Select(c => c - '0').ToArray();
        var controlDigit = digits[^1];
        var payload = digits[..^1].Reverse().ToArray();
        var sum = 0;

        for (var i = 0; i < payload.Length; i += 1)
        {
            var factor = i % 2 == 0 ? 2 : 1;
            var value = payload[i] * factor;
            if (value > 9) value -= 9;
            sum += value;
        }

        var calculated = (10 - (sum % 10)) % 10;
        return calculated == controlDigit;
    }

    public static bool IsValidMod11(string numberString)
    {
        if (!IsOnlyDigits(numberString) || numberString.Length < 2) return false;

        var digits = numberString.Select(c => c - '0').ToArray();
        var controlDigit = digits[^1];
        var payload = digits[..^1].Reverse().ToArray();
        var sum = 0;

        for (var i = 0; i < payload.Length; i += 1)
        {
            var weight = (i % 6) + 2;
            sum += payload[i] * weight;
        }

        var remainder = sum % 11;
        var calculated = 11 - remainder;
        if (calculated == 11) calculated = 0;
        if (calculated == 10) return false;

        return calculated == controlDigit;
    }
}

static class Amount
{
    public static string? TryFormat(string? rawAmount)
    {
        var normalized = (rawAmount ?? string.Empty).Replace(',', '.').Trim();
        if (!decimal.TryParse(normalized, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
        {
            return null;
        }

        if (parsed <= 0) return null;
        return parsed.ToString("0.00", CultureInfo.InvariantCulture);
    }
}

static class DueDate
{
    public static bool IsTodayOrFuture(string dateString)
    {
        if (!DateOnly.TryParseExact(dateString, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dueDate))
        {
            return false;
        }

        return dueDate >= DateOnly.FromDateTime(DateTime.Today);
    }
}

static class PainXml
{
    private const string PayerName = "Kraft Bank ASA";
    private const string PayerOrgNo = "918315446";
    private const string PayerBban = "32072278835";

    public static string Build(List<ValidatedEntry> transactions)
    {
        var nowUtc = DateTime.UtcNow;
        var stamp = nowUtc.ToString("yyyyMMddHHmmss");

        var grouped = transactions
            .OrderBy(tx => tx.DueDate, StringComparer.Ordinal)
            .GroupBy(tx => tx.DueDate, StringComparer.Ordinal)
            .ToList();

        var instructionSequence = 1;
        var paymentInfos = new List<string>();
        for (var i = 0; i < grouped.Count; i += 1)
        {
            var txs = grouped[i]
                .Select(tx =>
                {
                    var clone = tx with { InstrId = instructionSequence.ToString(CultureInfo.InvariantCulture) };
                    instructionSequence += 1;
                    return clone;
                })
                .ToList();

            paymentInfos.Add(BuildPaymentInfo(stamp, i + 1, grouped[i].Key, txs));
        }

        var totalAmount = transactions.Sum(tx => decimal.Parse(tx.Amount, CultureInfo.InvariantCulture))
            .ToString("0.00", CultureInfo.InvariantCulture);

        return $"""
<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>MSG{Escape(stamp)}</MsgId>
      <CreDtTm>{Escape(nowUtc.ToString("yyyy-MM-ddTHH:mm:ss"))}</CreDtTm>
      <NbOfTxs>{transactions.Count}</NbOfTxs>
      <CtrlSum>{Escape(totalAmount)}</CtrlSum>
      <InitgPty>
        <Nm>{Escape(PayerName)}</Nm>
        <Id>
          <OrgId>
            <Othr>
              <Id>{Escape(PayerOrgNo)}</Id>
              <SchmeNm>
                <Cd>CUST</Cd>
              </SchmeNm>
            </Othr>
          </OrgId>
        </Id>
      </InitgPty>
    </GrpHdr>
    {string.Join('\n', paymentInfos)}
  </CstmrCdtTrfInitn>
</Document>
""";
    }

    public static string BuildGeneratedFileName(DateTime date)
    {
        return $"pain001_KraftBankASA_{date:yyyyMMdd_HHmmss}.xml";
    }

    private static string BuildPaymentInfo(string stamp, int index, string dueDate, List<ValidatedEntry> transactions)
    {
        var ctrlSum = transactions.Sum(tx => decimal.Parse(tx.Amount, CultureInfo.InvariantCulture))
            .ToString("0.00", CultureInfo.InvariantCulture);
        var transactionsXml = string.Join('\n', transactions.Select(BuildTransaction));

        return $"""
<PmtInf>
      <PmtInfId>PMT{Escape(stamp)}_{index}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <PmtTpInf>
        <InstrPrty>NORM</InstrPrty>
      </PmtTpInf>
      <NbOfTxs>{transactions.Count}</NbOfTxs>
      <CtrlSum>{Escape(ctrlSum)}</CtrlSum>
      <ReqdExctnDt>{Escape(dueDate)}</ReqdExctnDt>
      <Dbtr>
        <Nm>{Escape(PayerName)}</Nm>
        <PstlAdr>
          <Ctry>NO</Ctry>
        </PstlAdr>
        <Id>
          <OrgId>
            <Othr>
              <Id>{Escape(PayerOrgNo)}</Id>
              <SchmeNm>
                <Cd>CUST</Cd>
              </SchmeNm>
            </Othr>
          </OrgId>
        </Id>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <Othr>
            <Id>{Escape(PayerBban)}</Id>
            <SchmeNm>
              <Cd>BBAN</Cd>
            </SchmeNm>
          </Othr>
        </Id>
        <Ccy>NOK</Ccy>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <BIC>SPRONO22</BIC>
        </FinInstnId>
      </DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      {transactionsXml}
    </PmtInf>
""";
    }

    private static string BuildTransaction(ValidatedEntry tx)
    {
        var remittanceXml = tx.Kid.Length > 0
            ? $"""
<RmtInf>
          <Strd>
            <CdtrRefInf>
              <Tp>
                <CdOrPrtry>
                  <Cd>SCOR</Cd>
                </CdOrPrtry>
              </Tp>
              <Ref>{Escape(tx.Kid)}</Ref>
            </CdtrRefInf>
          </Strd>
        </RmtInf>
"""
            : (tx.CustomerNote.Length > 0
                ? $"""
<RmtInf>
          <Ustrd>{Escape(tx.CustomerNote)}</Ustrd>
        </RmtInf>
"""
                : string.Empty);

        var supplementaryDataXml = tx.InternalNote.Length > 0
            ? $"""
<SplmtryData>
          <Envlp>
            <InterntNotat>{Escape(tx.InternalNote)}</InterntNotat>
          </Envlp>
        </SplmtryData>
"""
            : string.Empty;

        return $"""
<CdtTrfTxInf>
        <PmtId>
          <InstrId>{Escape(tx.InstrId)}</InstrId>
          <EndToEndId>{Escape(tx.EndToEndId)}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="NOK">{Escape(tx.Amount)}</InstdAmt>
        </Amt>
        <CdtrAgt>
          <FinInstnId/>
        </CdtrAgt>
        <Cdtr>
          <Nm>{Escape(tx.Creditor)}</Nm>
          <PstlAdr>
            <Ctry>NO</Ctry>
          </PstlAdr>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <Othr>
              <Id>{Escape(tx.AccountNumber)}</Id>
              <SchmeNm>
                <Cd>BBAN</Cd>
              </SchmeNm>
            </Othr>
          </Id>
        </CdtrAcct>
        {remittanceXml}
        {supplementaryDataXml}
      </CdtTrfTxInf>
""";
    }

    private static string Escape(string value)
    {
        return SecurityElement.Escape(value) ?? string.Empty;
    }
}

sealed class ValidationResult<T>
{
    public T? Value { get; private init; }
    public string? Error { get; private init; }

    public static ValidationResult<T> Ok(T value) => new() { Value = value };
    public static ValidationResult<T> Fail(string error) => new() { Error = error };
}

sealed class PainRequest
{
    public List<IncomingEntry>? Entries { get; set; }
    public string? CaseHandler { get; set; }
    public string? CloNumber { get; set; }
    public string? ForingId { get; set; }
}

sealed class IncomingEntry
{
    public string? Creditor { get; set; }
    public string? Kid { get; set; }
    public string? CustomerNote { get; set; }
    public string? InternalNote { get; set; }
    public string? AccountNumber { get; set; }
    public string? Amount { get; set; }
    public string? DueDate { get; set; }
    public bool BoligLaan { get; set; }
}

sealed class UpdateCreditorsPayload
{
    public List<CreditorRecord>? Creditors { get; set; }
}

sealed class CreateForingRequest
{
    public string? CloNumber { get; set; }
    public string? CaseHandler { get; set; }
}

sealed class UpdateForingRequest
{
    public string? CloNumber { get; set; }
    public string? CaseHandler { get; set; }
    public string? Etableringshonorar { get; set; }
    public string? Status { get; set; }
    public List<IncomingEntry>? Entries { get; set; }
}

sealed class CreditorRecord
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string AccountNumber { get; set; } = string.Empty;
}

sealed class HistoryEntry
{
    public string? Id { get; set; }
    public string? CreatedAt { get; set; }
    public string? CaseHandler { get; set; }
    public string? CloNumber { get; set; }
    public int TransactionsCount { get; set; }
    public string? GeneratedFileName { get; set; }
    public string BackupFileName { get; set; } = string.Empty;
}

sealed class ForingDocument
{
    public string Id { get; set; } = string.Empty;
    public string CloNumber { get; set; } = string.Empty;
    public string CaseHandler { get; set; } = string.Empty;
    public string Etableringshonorar { get; set; } = string.Empty;
    public string? CreatedAt { get; set; }
    public string? UpdatedAt { get; set; }
    public string Status { get; set; } = ForingStatuses.Pagaende;
    public List<IncomingEntry> Entries { get; set; } = new();
}

static class ForingStatuses
{
    public const string Pagaende = "Pågående";
    public const string Avsluttet = "Avsluttet";
    public const string Utbetalt = "Utbetalt";

    public static string? Normalize(string? raw)
    {
        var value = (raw ?? string.Empty).Trim();
        return value switch
        {
            "Pågående" or "Pagaende" => Pagaende,
            "Avsluttet" => Avsluttet,
            "Utbetalt" => Utbetalt,
            _ => null
        };
    }
}

sealed record ValidatedEntry
{
    public string Creditor { get; init; } = string.Empty;
    public string Kid { get; init; } = string.Empty;
    public string CustomerNote { get; init; } = string.Empty;
    public string EndToEndId { get; init; } = string.Empty;
    public string InternalNote { get; init; } = string.Empty;
    public string AccountNumber { get; init; } = string.Empty;
    public string Amount { get; init; } = string.Empty;
    public string DueDate { get; init; } = string.Empty;
    public string InstrId { get; init; } = string.Empty;
}
