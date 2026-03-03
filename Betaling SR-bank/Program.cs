using System.Globalization;
using System.Security;
using System.Text;
using System.Text.Json;
using System.Xml;

var options = new WebApplicationOptions
{
    Args = args,
    WebRootPath = "public"
};
var builder = WebApplication.CreateBuilder(options);

var app = builder.Build();
var storageRootPath = (Environment.GetEnvironmentVariable("APP_STORAGE_ROOT") ?? string.Empty).Trim();
if (string.IsNullOrWhiteSpace(storageRootPath))
{
    storageRootPath = app.Environment.ContentRootPath;
}
var dataStore = new DataStore(storageRootPath, app.Environment.ContentRootPath);
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
            Hovedlantaker = string.Empty,
            Lantakere = new List<string>(),
            InnvilgetLaanMedPant = string.Empty,
            InnvilgetUsikretLaan = string.Empty,
            Etableringshonorar = string.Empty,
            FirstPaymentDate = string.Empty,
            FirstPaymentAmount = string.Empty,
            FirstPaymentKid = string.Empty,
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

        if (payload?.FirstPaymentDate is not null)
        {
            item.FirstPaymentDate = payload.FirstPaymentDate.Trim();
        }

        if (payload?.FirstPaymentAmount is not null)
        {
            item.FirstPaymentAmount = payload.FirstPaymentAmount.Trim();
        }

        if (payload?.FirstPaymentKid is not null)
        {
            item.FirstPaymentKid = payload.FirstPaymentKid.Trim();
        }

        if (payload?.InnvilgetLaanMedPant is not null)
        {
            item.InnvilgetLaanMedPant = payload.InnvilgetLaanMedPant.Trim();
        }

        if (payload?.InnvilgetUsikretLaan is not null)
        {
            item.InnvilgetUsikretLaan = payload.InnvilgetUsikretLaan.Trim();
        }

        if (payload?.Hovedlantaker is not null)
        {
            var hovedlantaker = payload.Hovedlantaker.Trim();
            if (string.IsNullOrWhiteSpace(hovedlantaker))
            {
                return Results.Json(new { error = "Hovedlantaker ma fylles ut." }, statusCode: 400);
            }
            item.Hovedlantaker = hovedlantaker;
        }

        if (payload?.Lantakere is not null)
        {
            item.Lantakere = payload.Lantakere
                .Select(value => (value ?? string.Empty).Trim())
                .Where(value => value.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
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

    var entries = (payload?.Entries ?? new List<IncomingEntry>())
        .Where(entry => entry.Infridd)
        .ToList();
    var caseHandler = (payload?.CaseHandler ?? string.Empty).Trim();
    var cloNumber = (payload?.CloNumber ?? string.Empty).Trim();
    var foringId = (payload?.ForingId ?? string.Empty).Trim();

    if (entries.Count == 0)
    {
        return Results.Json(new { error = "Ingen linjer klare for XML. Velg Skal innfris = Ja pa minst en linje." }, statusCode: 400);
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

    var xml = PainXml.Build(validated, cloNumber);
    var preflightResult = PainPreflight.Validate(xml);
    if (preflightResult.Error is not null)
    {
        return Results.Json(new { error = $"Pre-flight validering feilet: {preflightResult.Error}" }, statusCode: 400);
    }

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
app.Urls.Add($"http://0.0.0.0:{port}");
app.Run();

sealed class DataStore(string rootPath, string seedRootPath)
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
    public string SeedDataDirectory { get; } = Path.Combine(seedRootPath, "data");
    public string SeedMarkerFile { get; } = Path.Combine(rootPath, "data", ".seeded");

    public void EnsureStores()
    {
        Directory.CreateDirectory(DataDirectory);
        Directory.CreateDirectory(BackupDirectory);
        EnsureJsonFile(CreditorsFile);
        EnsureJsonFile(HistoryFile);
        EnsureJsonFile(ForingerFile);
        SeedCreditorsOnce();
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

    private static void EnsureJsonFile(string filePath)
    {
        if (!File.Exists(filePath))
        {
            File.WriteAllText(filePath, "[]");
        }
    }

    private void SeedCreditorsOnce()
    {
        if (File.Exists(SeedMarkerFile))
        {
            return;
        }

        var seedCreditorsFile = Path.Combine(SeedDataDirectory, "creditors.json");
        if (!File.Exists(seedCreditorsFile))
        {
            File.WriteAllText(SeedMarkerFile, DateTime.UtcNow.ToString("o"));
            return;
        }

        var current = File.ReadAllText(CreditorsFile).Trim();
        var currentIsEmptyList = string.IsNullOrWhiteSpace(current) || current == "[]";
        if (!currentIsEmptyList)
        {
            File.WriteAllText(SeedMarkerFile, DateTime.UtcNow.ToString("o"));
            return;
        }

        var seedContent = File.ReadAllText(seedCreditorsFile).Trim();
        var seedHasData = !string.IsNullOrWhiteSpace(seedContent) && seedContent != "[]";
        if (seedHasData)
        {
            File.WriteAllText(CreditorsFile, seedContent);
        }

        File.WriteAllText(SeedMarkerFile, DateTime.UtcNow.ToString("o"));
    }
}

static class Validation
{
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

        if (hasCustomerNote && cleanCustomerNote.Length > 280)
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Notat til kunde kan maks vaere 280 tegn.");
        }

        if (hasCustomerNote && !CustomerNoteCharacters.IsAllowed(cleanCustomerNote))
        {
            return ValidationResult<ValidatedEntry>.Fail($"Linje {lineNumber}: Notat til kunde inneholder ugyldige tegn.");
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
            EndToEndId = hasKid ? cleanKid : $"NOTE{lineNumber:D4}",
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
        var raw = rawAmount ?? string.Empty;
        var compact = new string(raw.Where(c => !char.IsWhiteSpace(c)).ToArray()).Trim();
        if (compact.Length == 0)
        {
            return null;
        }

        var normalized = NormalizeNumber(compact);
        if (!decimal.TryParse(
                normalized,
                NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
                CultureInfo.InvariantCulture,
                out var parsed))
        {
            return null;
        }

        if (parsed <= 0) return null;
        return parsed.ToString("0.00", CultureInfo.InvariantCulture);
    }

    private static string NormalizeNumber(string value)
    {
        var commaCount = value.Count(c => c == ',');
        var dotCount = value.Count(c => c == '.');

        // Mixed separators (e.g. 1.234,56 or 1,234.56): last separator is treated as decimal.
        if (commaCount > 0 && dotCount > 0)
        {
            var lastComma = value.LastIndexOf(',');
            var lastDot = value.LastIndexOf('.');
            var decimalSeparator = lastComma > lastDot ? ',' : '.';
            var thousandSeparator = decimalSeparator == ',' ? '.' : ',';

            var withoutThousands = value.Replace(thousandSeparator.ToString(), string.Empty);
            return decimalSeparator == ','
                ? withoutThousands.Replace(',', '.')
                : withoutThousands;
        }

        if (commaCount > 0)
        {
            return NormalizeSingleSeparator(value, ',');
        }

        if (dotCount > 0)
        {
            return NormalizeSingleSeparator(value, '.');
        }

        return value;
    }

    private static string NormalizeSingleSeparator(string value, char separator)
    {
        var count = value.Count(c => c == separator);
        if (count > 1)
        {
            return value.Replace(separator.ToString(), string.Empty);
        }

        var separatorIndex = value.LastIndexOf(separator);
        var digitsAfter = value.Length - separatorIndex - 1;

        // If exactly one separator and at most 2 trailing digits, treat it as decimal separator.
        if (digitsAfter is >= 1 and <= 2)
        {
            return separator == ',' ? value.Replace(',', '.') : value;
        }

        // Otherwise treat it as thousand separator.
        return value.Replace(separator.ToString(), string.Empty);
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

static class CustomerNoteCharacters
{
    public static bool IsAllowed(string value)
    {
        foreach (var c in value)
        {
            if (char.IsControl(c))
            {
                return false;
            }

            if (char.IsLetterOrDigit(c) || char.IsWhiteSpace(c))
            {
                continue;
            }

            if (".,:;!?()/-+&'\"".Contains(c))
            {
                continue;
            }

            return false;
        }

        return true;
    }
}

static class PainXml
{
    private const string PayerName = "Kraft Bank ASA";
    private const string PayerOrgNo = "918315446";
    private const string PayerBban = "32072278835";

    public static string Build(List<ValidatedEntry> transactions, string cloNumber)
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

            paymentInfos.Add(BuildPaymentInfo(stamp, i + 1, grouped[i].Key, txs, cloNumber));
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

    private static string BuildPaymentInfo(string stamp, int index, string dueDate, List<ValidatedEntry> transactions, string cloNumber)
    {
        var transactionsXml = string.Join('\n', transactions.Select(tx => BuildTransaction(tx, cloNumber)));

        return $"""
<PmtInf>
      <PmtInfId>PMT{Escape(stamp)}_{index}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <PmtTpInf>
        <InstrPrty>NORM</InstrPrty>
        <SvcLvl>
          <Cd>NURG</Cd>
        </SvcLvl>
        <CtgyPurp>
          <Cd>SUPP</Cd>
        </CtgyPurp>
      </PmtTpInf>
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
      {transactionsXml}
    </PmtInf>
""";
    }

    private static string BuildTransaction(ValidatedEntry tx, string cloNumber)
    {
        var remittanceXml = BuildRemittanceXml(tx, cloNumber);

        return $"""
<CdtTrfTxInf>
        <PmtId>
          <InstrId>{Escape(tx.InstrId)}</InstrId>
          <EndToEndId>{Escape(tx.EndToEndId)}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="NOK">{Escape(tx.Amount)}</InstdAmt>
        </Amt>
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
      </CdtTrfTxInf>
""";
    }

    private static string BuildRemittanceXml(ValidatedEntry tx, string cloNumber)
    {
        var addtlRmtInfValues = BuildAddtlRmtInfValues(tx.CustomerNote, cloNumber)
            .Select(value => $"            <AddtlRmtInf>{Escape(value)}</AddtlRmtInf>")
            .ToList();
        var addtlRmtInfXml = string.Join('\n', addtlRmtInfValues);

        // Use structured remittance to carry CLO number via AddtlRmtInf on every transaction.
        if (tx.Kid.Length > 0)
        {
            return $"""
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
{addtlRmtInfXml}
          </Strd>
        </RmtInf>
""";
        }

        if (tx.CustomerNote.Length > 0)
        {
            return $"""
<RmtInf>
          <Strd>
{addtlRmtInfXml}
          </Strd>
        </RmtInf>
""";
        }

        return string.Empty;
    }

    private static List<string> BuildAddtlRmtInfValues(string customerNote, string cloNumber)
    {
        var values = new List<string>();
        var cleanCustomerNote = (customerNote ?? string.Empty).Trim();
        if (cleanCustomerNote.Length > 0)
        {
            values.AddRange(SplitIntoChunks(cleanCustomerNote, 140));
        }

        values.Add($"CLO {cloNumber.Trim()}");

        if (values.Count > 3)
        {
            return values.Take(3).ToList();
        }

        return values;
    }

    private static IEnumerable<string> SplitIntoChunks(string value, int maxLength)
    {
        for (var i = 0; i < value.Length; i += maxLength)
        {
            var length = Math.Min(maxLength, value.Length - i);
            yield return value.Substring(i, length);
        }
    }

    private static string Escape(string value)
    {
        return SecurityElement.Escape(value) ?? string.Empty;
    }
}

static class PainPreflight
{
    private const string PainNamespace = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.03";

    public static ValidationResult<bool> Validate(string xml)
    {
        var doc = new XmlDocument();
        try
        {
            doc.LoadXml(xml);
        }
        catch (Exception ex)
        {
            return ValidationResult<bool>.Fail($"Ugyldig XML: {ex.Message}");
        }

        var ns = new XmlNamespaceManager(doc.NameTable);
        ns.AddNamespace("p", PainNamespace);

        var root = doc.SelectSingleNode("/p:Document", ns);
        if (root is null)
        {
            return ValidationResult<bool>.Fail("Mangler Document-root med forventet namespace.");
        }

        var txNodes = doc.SelectNodes("//p:CdtTrfTxInf", ns);
        var txCount = txNodes?.Count ?? 0;
        if (txCount == 0)
        {
            return ValidationResult<bool>.Fail("Ingen CdtTrfTxInf funnet.");
        }

        var grpNbOfTxsText = doc.SelectSingleNode("//p:GrpHdr/p:NbOfTxs", ns)?.InnerText;
        if (!int.TryParse(grpNbOfTxsText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var grpNbOfTxs) || grpNbOfTxs != txCount)
        {
            return ValidationResult<bool>.Fail($"GrpHdr/NbOfTxs ({grpNbOfTxsText ?? "mangler"}) matcher ikke antall transaksjoner ({txCount}).");
        }

        var sum = 0m;
        foreach (XmlNode tx in txNodes!)
        {
            var amountText = tx.SelectSingleNode("p:Amt/p:InstdAmt", ns)?.InnerText;
            if (!decimal.TryParse(amountText, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount))
            {
                return ValidationResult<bool>.Fail("Fant transaksjon med ugyldig eller manglende InstdAmt.");
            }

            sum += amount;
        }

        var grpCtrlSumText = doc.SelectSingleNode("//p:GrpHdr/p:CtrlSum", ns)?.InnerText;
        if (!decimal.TryParse(grpCtrlSumText, NumberStyles.Number, CultureInfo.InvariantCulture, out var grpCtrlSum))
        {
            return ValidationResult<bool>.Fail("GrpHdr/CtrlSum mangler eller har ugyldig format.");
        }

        if (grpCtrlSum != sum)
        {
            return ValidationResult<bool>.Fail($"GrpHdr/CtrlSum ({grpCtrlSum.ToString("0.00", CultureInfo.InvariantCulture)}) matcher ikke sum av transaksjoner ({sum.ToString("0.00", CultureInfo.InvariantCulture)}).");
        }

        var pmtInfos = doc.SelectNodes("//p:PmtInf", ns);
        if (pmtInfos is null || pmtInfos.Count == 0)
        {
            return ValidationResult<bool>.Fail("Ingen PmtInf funnet.");
        }

        foreach (XmlNode pmtInf in pmtInfos)
        {
            if (pmtInf.SelectSingleNode("p:NbOfTxs", ns) is not null)
            {
                return ValidationResult<bool>.Fail("PmtInf/NbOfTxs skal ikke sendes i denne bankprofilen.");
            }

            if (pmtInf.SelectSingleNode("p:CtrlSum", ns) is not null)
            {
                return ValidationResult<bool>.Fail("PmtInf/CtrlSum skal ikke sendes i denne bankprofilen.");
            }

            if (pmtInf.SelectSingleNode("p:ChrgBr", ns) is not null)
            {
                return ValidationResult<bool>.Fail("PmtInf/ChrgBr skal ikke sendes for lokal profil.");
            }

            var svcLvl = pmtInf.SelectSingleNode("p:PmtTpInf/p:SvcLvl/p:Cd", ns)?.InnerText;
            if (!string.Equals(svcLvl, "NURG", StringComparison.Ordinal))
            {
                return ValidationResult<bool>.Fail("PmtTpInf/SvcLvl/Cd ma vaere NURG.");
            }

            var ctgyPurp = pmtInf.SelectSingleNode("p:PmtTpInf/p:CtgyPurp/p:Cd", ns)?.InnerText;
            if (!string.Equals(ctgyPurp, "SUPP", StringComparison.Ordinal))
            {
                return ValidationResult<bool>.Fail("PmtTpInf/CtgyPurp/Cd ma vaere SUPP.");
            }
        }

        for (var i = 0; i < txNodes!.Count; i += 1)
        {
            var tx = txNodes[i]!;
            var line = i + 1;

            if (tx.SelectSingleNode("p:CdtrAgt", ns) is not null)
            {
                return ValidationResult<bool>.Fail($"Linje {line}: CdtrAgt skal ikke sendes uten gyldig innhold.");
            }

            var hasStrd = tx.SelectSingleNode("p:RmtInf/p:Strd", ns) is not null;
            if (!hasStrd)
            {
                return ValidationResult<bool>.Fail($"Linje {line}: RmtInf/Strd ma vaere satt.");
            }

            var addtlRemittanceNodes = tx.SelectNodes("p:RmtInf/p:Strd/p:AddtlRmtInf", ns);
            if (addtlRemittanceNodes is null || addtlRemittanceNodes.Count == 0)
            {
                return ValidationResult<bool>.Fail($"Linje {line}: RmtInf/Strd/AddtlRmtInf ma vaere satt.");
            }

            if (addtlRemittanceNodes.Count > 3)
            {
                return ValidationResult<bool>.Fail($"Linje {line}: Maks 3 AddtlRmtInf er tillatt.");
            }

            foreach (XmlNode addtlNode in addtlRemittanceNodes)
            {
                var addtlValue = (addtlNode.InnerText ?? string.Empty).Trim();
                if (addtlValue.Length is < 1 or > 140)
                {
                    return ValidationResult<bool>.Fail($"Linje {line}: AddtlRmtInf ma vaere 1-140 tegn.");
                }
            }

            var kidRefNode = tx.SelectSingleNode("p:RmtInf/p:Strd/p:CdtrRefInf/p:Ref", ns);
            if (kidRefNode is not null)
            {
                var refCode = tx.SelectSingleNode("p:RmtInf/p:Strd/p:CdtrRefInf/p:Tp/p:CdOrPrtry/p:Cd", ns)?.InnerText;
                if (!string.Equals(refCode, "SCOR", StringComparison.Ordinal))
                {
                    return ValidationResult<bool>.Fail($"Linje {line}: Strukturert KID ma bruke CdtrRefInf/Tp/CdOrPrtry/Cd = SCOR.");
                }

                var kidRef = kidRefNode.InnerText ?? string.Empty;
                if (kidRef.Length < 2 || kidRef.Length > 25 || !kidRef.All(char.IsDigit))
                {
                    return ValidationResult<bool>.Fail($"Linje {line}: KID-referanse ma vaere 2-25 sifre.");
                }
            }
        }

        return ValidationResult<bool>.Ok(true);
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
    public string? Owner { get; set; }
    public string? Source { get; set; }
    public string? CustomerNote { get; set; }
    public string? InternalNote { get; set; }
    public string? Kommentar { get; set; }
    public string? AccountNumber { get; set; }
    public string? Amount { get; set; }
    public string? DueDate { get; set; }
    public string? TypeKrav { get; set; }
    public string? RowUpdatedAt { get; set; }
    public bool Infridd { get; set; } = true;
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
    public string? Hovedlantaker { get; set; }
    public List<string>? Lantakere { get; set; }
    public string? InnvilgetLaanMedPant { get; set; }
    public string? InnvilgetUsikretLaan { get; set; }
    public string? Etableringshonorar { get; set; }
    public string? FirstPaymentDate { get; set; }
    public string? FirstPaymentAmount { get; set; }
    public string? FirstPaymentKid { get; set; }
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
    public string Hovedlantaker { get; set; } = string.Empty;
    public List<string> Lantakere { get; set; } = new();
    public string InnvilgetLaanMedPant { get; set; } = string.Empty;
    public string InnvilgetUsikretLaan { get; set; } = string.Empty;
    public string Etableringshonorar { get; set; } = string.Empty;
    public string FirstPaymentDate { get; set; } = string.Empty;
    public string FirstPaymentAmount { get; set; } = string.Empty;
    public string FirstPaymentKid { get; set; } = string.Empty;
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
