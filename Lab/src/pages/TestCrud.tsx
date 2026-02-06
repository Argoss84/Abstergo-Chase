import { useState, useEffect } from 'react';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButton,
  IonList,
  IonItem,
  IonLabel,
  IonModal,
  IonInput,
  IonTextarea,
  IonAlert,
  IonSpinner,
} from '@ionic/react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5175';

interface TestRecord {
  ID: number;
  ColonneInt: number;
  ColonneText: string;
  ColonneDate: string;
}

const TestCrud: React.FC = () => {
  const [items, setItems] = useState<TestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteAlert, setDeleteAlert] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [form, setForm] = useState({ ColonneInt: 0, ColonneText: '', ColonneDate: '' });
  const [saving, setSaving] = useState(false);

  const loadItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/test`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ColonneInt: 0, ColonneText: '', ColonneDate: new Date().toISOString().slice(0, 10) });
    setModalOpen(true);
  };

  const openEdit = (item: TestRecord) => {
    setEditingId(item.ID);
    setForm({
      ColonneInt: item.ColonneInt,
      ColonneText: item.ColonneText,
      ColonneDate: item.ColonneDate?.slice(0, 10) || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.ColonneText.trim() || !form.ColonneDate) return;
    setSaving(true);
    try {
      const body = {
        ColonneInt: Number(form.ColonneInt) || 0,
        ColonneText: form.ColonneText.trim(),
        ColonneDate: form.ColonneDate,
      };
      const url = editingId ? `${API_URL}/api/test/${editingId}` : `${API_URL}/api/test`;
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || res.statusText);
      }
      setModalOpen(false);
      loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (id: number) => setDeleteAlert({ open: true, id });
  const handleDelete = async () => {
    const id = deleteAlert.id;
    if (!id) return;
    setDeleteAlert({ open: false, id: null });
    try {
      const res = await fetch(`${API_URL}/api/test/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la suppression');
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/" />
          </IonButtons>
          <IonTitle>CRUD Table test</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={openCreate}>Ajouter</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <div className="ion-padding">
          {error && (
            <div style={{ color: 'var(--ion-color-danger)', marginBottom: 16 }}>{error}</div>
          )}
          {loading ? (
            <div className="ion-text-center ion-padding">
              <IonSpinner />
            </div>
          ) : (
            <IonList>
              {items.length === 0 ? (
                <IonItem>
                  <IonLabel color="medium">Aucun enregistrement</IonLabel>
                </IonItem>
              ) : (
                items.map((item) => (
                  <IonItem key={item.ID}>
                    <IonLabel>
                      <h2>ID {item.ID}</h2>
                      <p>Int: {item.ColonneInt} | Date: {item.ColonneDate}</p>
                      <p>{item.ColonneText}</p>
                    </IonLabel>
                    <IonButton fill="clear" slot="end" onClick={() => openEdit(item)}>
                      Modifier
                    </IonButton>
                    <IonButton fill="clear" color="danger" slot="end" onClick={() => confirmDelete(item.ID)}>
                      Supprimer
                    </IonButton>
                  </IonItem>
                ))
              )}
            </IonList>
          )}
        </div>

        <IonModal isOpen={modalOpen} onDidDismiss={() => setModalOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{editingId ? 'Modifier' : 'Nouvel enregistrement'}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setModalOpen(false)}>Fermer</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonInput
              label="ColonneInt"
              type="number"
              value={form.ColonneInt}
              onIonInput={(e) => setForm({ ...form, ColonneInt: Number((e as CustomEvent).detail?.value) || 0 })}
              placeholder="Entier"
              style={{ marginBottom: 12 }}
            />
            <IonTextarea
              label="ColonneText"
              value={form.ColonneText}
              onIonInput={(e) => setForm({ ...form, ColonneText: String((e as CustomEvent).detail?.value ?? '') })}
              placeholder="Texte"
              rows={4}
              style={{ marginBottom: 12 }}
            />
            <IonInput
              label="ColonneDate"
              type="date"
              value={form.ColonneDate}
              onIonInput={(e) => setForm({ ...form, ColonneDate: String((e as CustomEvent).detail?.value ?? '') })}
              style={{ marginBottom: 12 }}
            />
            <IonButton expand="block" onClick={handleSave} disabled={saving} style={{ marginTop: 16 }}>
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </IonButton>
          </IonContent>
        </IonModal>

        <IonAlert
          isOpen={deleteAlert.open}
          header="Confirmer la suppression"
          message="Êtes-vous sûr de vouloir supprimer cet enregistrement ?"
          buttons={[
            { text: 'Annuler', role: 'cancel', handler: () => setDeleteAlert({ open: false, id: null }) },
            { text: 'Supprimer', role: 'destructive', handler: handleDelete },
          ]}
        />
      </IonContent>
    </IonPage>
  );
};

export default TestCrud;
