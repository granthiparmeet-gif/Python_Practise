from pydantic import BaseModel

class Patient(BaseModel):
    name : str
    age : int

    def patient_info(self):
        print(self.name)
        print(self.age)

y = { "name": "Parmeet", "age": 33}

z = Patient(**y)

z.patient_info()