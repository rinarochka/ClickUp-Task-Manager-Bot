const priorityMap = {
    urgent: 1,
    high: 2,
    normal: 3,
    low: 4,
};

const TechCategoryID = '189f5936-c11c-49b7-a8ea-1e1adb970365';

// Mapping Tech Category labels to option IDs
const techCategoryMap = {
    'front': 'bfa1e5b4-66fc-43d5-b6b3-a29936b4f7d1',
    'back': 'adfaeb52-e244-49a1-8244-a909c3f92236',
    'product': '3971d9c3-581a-4ac1-a2a9-2e67f47739b0',
    'devops': '6bfdb348-5a03-4009-ba97-0314a54a9f74',
    'design': 'a1b67c8a-1d58-433f-85a5-445161eb9f4a',
    'wordpress': '24cf18c1-9984-4be3-b507-4d7eb0523cb5'
};

export function parseTaskInput(text) {

    const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);

    // --- БАЗА ---
    let title = lines[0] || null;
    let description = lines[1] || lines[0] || '';

    // --- ПАРАМЕТРЫ ---
    let tags = [];
    let priority = 'normal';
    let sp = null;
    let tc = [];

    for (const line of lines) {
        if (line.startsWith('tags:'))
            tags = line.replace('tags:', '').split(',').map(t => t.trim());

        if (line.startsWith('pr:'))
            priority = line.replace('pr:', '').trim();

        if (line.startsWith('sp:'))
            sp = Number(line.replace('sp:', '').trim());

        if (line.startsWith('tc:'))
            tc = line.replace('tc:', '').split(',').map(t => t.trim());
    }

    return {
        title,
        description,
        tags,
        priority,
        sp,
        tc
    };
}