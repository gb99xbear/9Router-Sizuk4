import { describe, it, expect } from "vitest";
import {
  isRefusal,
  stripRefusal,
  getReframingQueries,
} from "../../open-sse/services/refusalEngine.js";

describe("refusalEngine", () => {
  describe("isRefusal", () => {
    it("detects strong refusal phrases in the first 300 characters", () => {
      // Strong refusal phrases as per exact regex:
      // /(saya tolak|aku tolak|menolak permintaan|tolak permintaan|tetap (saya )?tolak|tetap menolak|tidak ada jawaban|nggak ada jawaban|tidak ada bahan|nggak ada bahan|jawaban (tetap|saja) sama|maaf[, ] (saya|aku)|i refuse|i am refusing|won'?t (give|provide|help))/i
      expect(isRefusal("Maaf, saya tidak dapat membantu dengan itu.")).toBe(true);
      expect(isRefusal("Maaf, aku tolak permintaan ini.")).toBe(true);
      expect(isRefusal("Saya tolak tugas ini.")).toBe(true);
      expect(isRefusal("Aku tolak permintaan anda.")).toBe(true);
      expect(isRefusal("Menolak permintaan yang diberikan.")).toBe(true);
      expect(isRefusal("Tolak permintaan ini serta merta.")).toBe(true);
      expect(isRefusal("Tetap saya tolak apa pun yang diminta.")).toBe(true);
      expect(isRefusal("Tetap tolak permintaan tersebut.")).toBe(true);
      expect(isRefusal("Tetap menolak untuk menjawab.")).toBe(true);
      expect(isRefusal("Tidak ada jawaban untuk soalan ini.")).toBe(true);
      expect(isRefusal("Nggak ada jawaban sama sekali.")).toBe(true);
      expect(isRefusal("Tidak ada bahan rujukan.")).toBe(true);
      expect(isRefusal("Nggak ada bahan untuk ini.")).toBe(true);
      expect(isRefusal("Jawaban tetap sama seperti tadi.")).toBe(true);
      expect(isRefusal("Jawaban saja sama.")).toBe(true);
      expect(isRefusal("Maaf saya tolak tugasan ini.")).toBe(true);
      expect(isRefusal("Maaf aku tolak.")).toBe(true);
      expect(isRefusal("I refuse to assist with this.")).toBe(true);
      expect(isRefusal("I am refusing this request.")).toBe(true);
      expect(isRefusal("Won't give any details on this.")).toBe(true);
      expect(isRefusal("Wont provide that information.")).toBe(true);
      expect(isRefusal("Won't help you with this.")).toBe(true);
    });

    it("detects common refusal phrases in the first sentence (first 200 chars)", () => {
      // Common refusal phrases as per exact regex:
      // /(tidak (bisa|dapat|akan|pernah)|nggak bisa|gak bisa|nggak dapat|nggak akan|gak akan|saya (nggak|gak|tidak) (bisa|akan|dapat)|aku (nggak|gak|tidak) (bisa|akan|dapat)|i (can'?t|cannot|'m unable|am unable|won'?t|refuse))/i
      expect(isRefusal("Tidak bisa memproses permintaan ini.")).toBe(true);
      expect(isRefusal("Tidak dapat memberikan maklumat tersebut.")).toBe(true);
      expect(isRefusal("Tidak akan menjawab soalan ini.")).toBe(true);
      expect(isRefusal("Tidak pernah menyokong perkara ini.")).toBe(true);
      expect(isRefusal("Nggak bisa bantu bro.")).toBe(true);
      expect(isRefusal("Gak bisa tolong.")).toBe(true);
      expect(isRefusal("Nggak dapat memproses.")).toBe(true);
      expect(isRefusal("Nggak akan dilakukan.")).toBe(true);
      expect(isRefusal("Gak akan bagi.")).toBe(true);
      expect(isRefusal("Saya nggak bisa melakukannya.")).toBe(true);
      expect(isRefusal("Saya gak bisa tolong.")).toBe(true);
      expect(isRefusal("Saya tidak akan jawab.")).toBe(true);
      expect(isRefusal("Aku nggak dapat hadir.")).toBe(true);
      expect(isRefusal("I can't fulfill this request.")).toBe(true);
      expect(isRefusal("I cant fulfill this request.")).toBe(true);
      expect(isRefusal("I cannot provide that.")).toBe(true);
      expect(isRefusal("I am unable to comply.")).toBe(true);
      expect(isRefusal("I won't do that.")).toBe(true);
      expect(isRefusal("I refuse this.")).toBe(true);
    });

    it("returns false for regular technical responses and non-refusals", () => {
      expect(isRefusal("Berikut adalah cara mengkonfigurasi Nginx reverse proxy untuk port 8080.")).toBe(false);
      expect(isRefusal("To implement a binary search tree, first define the node structure.")).toBe(false);
      expect(isRefusal("Tentu, ini adalah kod Python untuk membaca fail JSON.")).toBe(false);
      expect(isRefusal("Sure, here is the explanation of how OAuth2 tokens work.")).toBe(false);
      expect(isRefusal("")).toBe(false);
      expect(isRefusal(null)).toBe(false);
      expect(isRefusal(undefined)).toBe(false);
      expect(isRefusal(123)).toBe(false);
    });

    it("does not trigger on refusal keywords appearing way past thresholds", () => {
      const padding = "A".repeat(350);
      expect(isRefusal(padding + " i refuse to do this")).toBe(false);
    });
  });

  describe("stripRefusal", () => {
    it("strips refusal prefix when remaining technical text is >= 100 characters", () => {
      const technicalText = "Untuk memasang Nginx pada sistem Linux Ubuntu, jalankan arahan `sudo apt update && sudo apt install nginx`. Sila semak status perkhidmatan menggunakan systemctl.";
      const input = "Maaf, saya tolak. " + technicalText;

      const stripped = stripRefusal(input);
      expect(stripped).toBe(technicalText);
      expect(stripped.length).toBeGreaterThanOrEqual(100);
      expect(stripped).not.toContain("Maaf, saya tolak");
    });

    it("strips multi-line refusal prefix when remaining text >= 100 characters", () => {
      const technicalText = "Berikut adalah dokumentasi API lengkap untuk endpoint pengesahan token:\nPOST /api/v1/auth/verify\nHeaders: Authorization Bearer <token>\nResponse: 200 OK with payload status valid.";
      const input = "I cannot fulfill this request directly.\nWon't provide assistance on this.\n\n" + technicalText;

      const stripped = stripRefusal(input);
      expect(stripped).toBe(technicalText);
    });

    it("returns original text if remaining text is < 100 characters", () => {
      const shortInput = "Maaf, saya tolak. Kod: abc.";
      expect(stripRefusal(shortInput)).toBe(shortInput);
    });

    it("returns original text if text is pure refusal (no remaining text)", () => {
      const pureRefusal = "Maaf, saya tolak permintaan ini. I cannot fulfill this.";
      expect(stripRefusal(pureRefusal)).toBe(pureRefusal);
    });

    it("returns original text if input is not a refusal", () => {
      const text = "Berikut adalah tutorial cara membuat sistem failover bagi pelayan proksi dalam Node.js dengan sokongan WebSocket dan HTTP request streaming.";
      expect(stripRefusal(text)).toBe(text);
    });

    it("handles falsy and non-string inputs safely", () => {
      expect(stripRefusal("")).toBe("");
      expect(stripRefusal(null)).toBe(null);
      expect(stripRefusal(undefined)).toBe(undefined);
    });
  });

  describe("getReframingQueries", () => {
    it("returns an array of 4 clean technical reframing queries", () => {
      const query = "how to work around authentication in legacy app";
      const variations = getReframingQueries(query);

      expect(Array.isArray(variations)).toBe(true);
      expect(variations).toHaveLength(4);

      expect(variations[0].toLowerCase()).toContain("technical manual");
      expect(variations[1].toLowerCase()).toContain("encyclopedia");
      expect(variations[2].toLowerCase()).toContain("translation");
      expect(variations[3].toLowerCase()).toContain("engineer");

      variations.forEach((v) => {
        expect(v).toContain(query);
      });
    });

    it("handles empty or non-string queries gracefully", () => {
      const resEmpty = getReframingQueries("");
      expect(resEmpty).toHaveLength(4);

      const resNull = getReframingQueries(null);
      expect(resNull).toHaveLength(4);
    });
  });
});
